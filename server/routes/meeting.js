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

//initialize custom utilities
const redis = require('../utils/datamanagement/redis.js');
const sfuRedis = redis.sfu; // Get the SFU Redis instance
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


        let assignedSfuId = await sfuRedis.hget(`meeting:${MeetingID}:metadata`, 'sfu_id');
        let assignedSignalingServerUrl = await sfuRedis.hget(`meeting:${MeetingID}:metadata`, 'signaling_server_url');

        console.info('/meeting/join: assignedSfuId: ', assignedSfuId);
        console.info('/meeting/join: assignedSignalingServerUrl: ', assignedSignalingServerUrl);

        if (!assignedSfuId || !assignedSignalingServerUrl) {
            
            const availableSfuIds = await sfuRedis.smembers('available_sfus');

            console.info('/meeting/join: Here are the available SFUs from the SFU Redis: ', availableSfuIds);

            if (availableSfuIds.length === 0) {
                console.info('/meeting/join: No available SFUs found. Please try again later.');
                return res.status(503).json({ error: 'No available SFUs found. Please try again later.' });
            }

            


            const bestSfuId = await findBestSfu(availableSfuIds);

            console.info('/meeting/join: bestSfuId: ', bestSfuId);

            assignedSfuId = bestSfuId;

            console.info('/meeting/join: assignedSfuId: ', assignedSfuId);
            console.info('/meeting/join: signalingServerURLs: ', signalingServerURLs);
            const bestSignalingServerUrl = await findBestSignalingServer(signalingServerURLs);

            console.info('/meeting/join: bestSignalingServerUrl: ', bestSignalingServerUrl);


            assignedSignalingServerUrl = bestSignalingServerUrl;

            await sfuRedis.hset(`meeting:${MeetingID}:metadata`, 
                'sfu_id', assignedSfuId,
                'signaling_server_url', assignedSignalingServerUrl
            );

            await redis.hset(`meeting:${MeetingID}:metadata`, 
                'sfu_id', assignedSfuId,
                'signaling_server_url', assignedSignalingServerUrl
            );

            console.log(`/meeting/join: Meeting ${MeetingID} assigned SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}`);

            // redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            //     type: 'prepareMeeting',
            //     payload: { meetingId: meetingId }
            //   }));

            await MeetingsProducer.send({
                topic: 'sfu_commands',
                messages: [
                    { key: assignedSfuId, value: JSON.stringify({ event: 'prepareMeeting', payload: { MeetingID } }) }
                ]
            });

            await MeetingsProducer.disconnect();
            } else{
                console.log(`/meeting/join: Meeting ${MeetingID} already assigned SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}`);
            }     


        console.info('/meeting/join: Returning meeting information');
        return res.status(201).json({ 
            message: 'Meeting created successfully', 
            meeting: MeetingID,
            sfu: assignedSfuId,
            signalingServer: assignedSignalingServerUrl
        });

    } catch (error) {
        console.error(`Path: ${process.env.BASE_URL || ''}/meeting/join, Unexpected error:`, error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;