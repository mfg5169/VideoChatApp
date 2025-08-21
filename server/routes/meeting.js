//import built-in dependencies
const path = require('path');
const fs = require('fs');
const fsSync = require('fs');


//import third-party dependencies
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

let redis = null;
let sfuRedis = null;
//initialize custom utilities

try{
    redis = require('../utils/datamanagement/redis.js');

    sfuRedis = redis.sfu; // Get the SFU Redis instance
}catch(error){
    console.error('Error importing redis:', error);
}

const { createMeeting, addParticipantToMeeting, findBestSfu, findBestSignalingServer } = require('../utils/meetings/meetings-helpers.js');
const { decryptSecret } = require('../utils/auth/encrytion.js');
const supabase = require('../utils/datamanagement/supabase.js');
const { MeetingsProducer } = require('../signaling/utils/communication.js');
//initialize router
const router = express.Router();

// load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });


// Get list of Signaling Server URLs from environment variable
const signalingServerURLsEnv = process.env.SIGNALING_SERVER_URLS || 'ws://localhost:8080';
const signalingServerURLs = signalingServerURLsEnv.split(',').map(url => url.trim());



router.post('/join', async (req, res) => {
    const { MeetingName } = req.body;
    const userId = req.user.userId; // Get userId from authenticated user

    let MeetingID = req.params.meetingId || null;

    
    if (!userId) {
        console.error('clientId is required.');
        return res.status(400).json({ error: 'clientId is required.' });
    }

    console.log("MeetingID: ", MeetingID);
    console.log("MeetingName: ", MeetingName);
    console.log("userId from token: ", userId);



    try {
        //Create the meeting

        if (!MeetingID) {
            const meetingInfo = await createMeeting(MeetingName, userId);
            MeetingID = meetingInfo.id;
        }

        console.info(`/meeting/join: MeetingID: ${MeetingID}`);
        console.info('/meeting/join: Adding participant to meeting');
        await addParticipantToMeeting(MeetingID, userId);

        console.info('/meeting/join: Added participant to meeting with MeetingID: ', MeetingID, ' and userId: ', userId);


        let assignedSfuId = null;
        let assignedSignalingServerUrl = null;

        // Try to get existing assignments with timeout and fallback
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Redis timeout')), 5000)
            );
            
            const redisPromise = Promise.all([
                sfuRedis.hget(`meeting:${MeetingID}:metadata`, 'sfu_id'),
                sfuRedis.hget(`meeting:${MeetingID}:metadata`, 'signaling_server_url')
            ]);
            
            [assignedSfuId, assignedSignalingServerUrl] = await Promise.race([redisPromise, timeoutPromise]);
            
            console.info('/meeting/join: assignedSfuId: ', assignedSfuId);
            console.info('/meeting/join: assignedSignalingServerUrl: ', assignedSignalingServerUrl);
        } catch (error) {
            console.warn('/meeting/join(checking for existing assignments): Redis timeout or error, proceeding with fallback:', error.message);
            // Continue with null values - will assign new ones
        }

        console.log("\n\n================================================\n\n")
        if (!assignedSfuId || !assignedSignalingServerUrl) {
            
            // Try to get available SFUs with timeout
            let availableSfuIds = [];
            try {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Redis timeout')), 5000)
                );
                
                availableSfuIds = await Promise.race([
                    sfuRedis.smembers('available_sfus'),
                    timeoutPromise
                ]);
                
                console.info('/meeting/join: Here are the available SFUs from the SFU Redis: ', availableSfuIds);
            } catch (error) {
                console.warn('/meeting/join: Could not get available SFUs from Redis:', error.message);
                // Use fallback SFU assignment
            }

            if (availableSfuIds.length === 0) {
                console.info('/meeting/join: No available SFUs found. Please try again later.');
                return res.status(503).json({ error: 'No available SFUs found. Please try again later.' });
            }

            


            // Try to find best SFU with timeout
            try {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('SFU selection timeout')), 5000)
                );
                
                const bestSfuId = await Promise.race([
                    findBestSfu(availableSfuIds),
                    timeoutPromise
                ]);
                
                console.info('/meeting/join: bestSfuId: ', bestSfuId);
                assignedSfuId = bestSfuId;
            } catch (error) {
                console.warn('/meeting/join: SFU selection failed:', error.message);
                return res.status(503).json({ error: 'SFU selection failed. Please try again later.' });
            }

            console.info('/meeting/join: assignedSfuId: ', assignedSfuId);
            console.info('/meeting/join: signalingServerURLs: ', signalingServerURLs);
            
            // Try to find best signaling server with timeout
            try {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Signaling server selection timeout')), 5000)
                );
                
                const bestSignalingServerUrl = await Promise.race([
                    findBestSignalingServer(signalingServerURLs),
                    timeoutPromise
                ]);
                
                console.info('/meeting/join: bestSignalingServerUrl: ', bestSignalingServerUrl);
                assignedSignalingServerUrl = bestSignalingServerUrl;
            } catch (error) {
                console.warn('/meeting/join: Signaling server selection failed:', error.message);
                return res.status(503).json({ error: 'Signaling server selection failed. Please try again later.' });
            }

            // Try to store assignments in Redis (non-blocking)
            try {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Redis storage timeout')), 3000)
                );
                
                await Promise.race([
                    Promise.all([
                        sfuRedis.hset(`meeting:${MeetingID}:metadata`, 
                            'sfu_id', assignedSfuId,
                            'signaling_server_url', assignedSignalingServerUrl
                        ),
                        redis.hset(`meeting:${MeetingID}:metadata`, 
                            'sfu_id', assignedSfuId,
                            'signaling_server_url', assignedSignalingServerUrl
                        )
                    ]),
                    timeoutPromise
                ]);
            } catch (error) {
                console.warn('/meeting/join: Failed to store assignments in Redis:', error.message);
                // Continue without storing - the meeting will still work
            }

            console.log(`/meeting/join: Meeting ${MeetingID} assigned SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}`);

            // redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            //     type: 'prepareMeeting',
            //     payload: { meetingId: meetingId }
            //   }));

            // Try to send Kafka message (non-blocking)
            try {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Kafka timeout')), 3000)
                );
                
                await Promise.race([
                    MeetingsProducer.send({
                        topic: 'sfu_commands',
                        messages: [
                            { key: assignedSfuId, value: JSON.stringify({ event: 'prepareMeeting', payload: { MeetingID } }) }
                        ]
                    }),
                    timeoutPromise
                ]);
                
                await MeetingsProducer.disconnect();
            } catch (error) {
                console.warn('/meeting/join: Failed to send Kafka message:', error.message);
                // Continue without Kafka - the meeting will still work
            }
            } else{
                console.log(`/meeting/join: Meeting ${MeetingID} already assigned SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}`);
            }     


        console.info('/meeting/join: Returning meeting information');
        return res.status(201).json({ 
            message: 'Meeting created successfully', 
            meetingID: MeetingID,
            sfu: assignedSfuId,
            signalingServer: assignedSignalingServerUrl
        });

    } catch (error) {
        console.error(`Path: ${process.env.BASE_URL || ''}/meeting/join, Unexpected error:`, error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;