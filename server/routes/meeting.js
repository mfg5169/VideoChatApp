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
const { sendMeetingPreparationCommand } = require('../utils/kafka-utils.js');

//initialize router
const router = express.Router();

// load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });


// Get list of Signaling Server URLs from environment variable
const signalingServerURLsEnv = process.env.SIGNALING_SERVER_URLS || 'ws://localhost:8080';
const signalingServerURLs = signalingServerURLsEnv.split(',').map(url => url.trim());

// Helper function to assign SFU and signaling server
async function assignMeetingResources(meetingId) {
    let assignedSfuId = null;
    let assignedSignalingServerUrl = null;

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
        
        console.info('/meeting: Here are the available SFUs from the SFU Redis: ', availableSfuIds);
    } catch (error) {
        console.warn('/meeting: Could not get available SFUs from Redis:', error.message);
        throw new Error('No available SFUs found. Please try again later.');
    }

    if (availableSfuIds.length === 0) {
        console.info('/meeting: No available SFUs found. Please try again later.');
        throw new Error('No available SFUs found. Please try again later.');
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
        
        console.info('/meeting: bestSfuId: ', bestSfuId);
        assignedSfuId = bestSfuId;
    } catch (error) {
        console.warn('/meeting: SFU selection failed:', error.message);
        throw new Error('SFU selection failed. Please try again later.');
    }

    // Try to find best signaling server with timeout
    try {
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Signaling server selection timeout')), 5000)
        );
        
        const bestSignalingServerUrl = await Promise.race([
            findBestSignalingServer(signalingServerURLs),
            timeoutPromise
        ]);
        
        console.info('/meeting: bestSignalingServerUrl: ', bestSignalingServerUrl);
        assignedSignalingServerUrl = bestSignalingServerUrl;
    } catch (error) {
        console.warn('/meeting: Signaling server selection failed:', error.message);
        throw new Error('Signaling server selection failed. Please try again later.');
    }

    // Try to store assignments in Redis (non-blocking)
    try {
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Redis storage timeout')), 3000)
        );
        
        await Promise.race([
            Promise.all([
                sfuRedis.hset(`meeting:${meetingId}:metadata`, 
                    'sfu_id', assignedSfuId,
                    'signaling_server_url', assignedSignalingServerUrl
                ),
                redis.hset(`meeting:${meetingId}:metadata`, 
                    'sfu_id', assignedSfuId,
                    'signaling_server_url', assignedSignalingServerUrl
                )
            ]),
            timeoutPromise
        ]);
    } catch (error) {
        console.warn('/meeting: Failed to store assignments in Redis:', error.message);
        // Continue without storing - the meeting will still work
    }

    // Try to send Kafka message (non-blocking)
    try {
        await sendMeetingPreparationCommand(assignedSfuId, meetingId);
    } catch (error) {
        console.warn('/meeting: Failed to send Kafka message:', error.message);
        // Continue without Kafka - the meeting will still work
    }

    return { assignedSfuId, assignedSignalingServerUrl };
}

// Helper function to get existing meeting assignments
async function getMeetingAssignments(meetingId) {
    try {
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Redis timeout')), 5000)
        );
        
        const redisPromise = Promise.all([
            sfuRedis.hget(`meeting:${meetingId}:metadata`, 'sfu_id'),
            sfuRedis.hget(`meeting:${meetingId}:metadata`, 'signaling_server_url')
        ]);
        
        const [assignedSfuId, assignedSignalingServerUrl] = await Promise.race([redisPromise, timeoutPromise]);
        
        console.info('/meeting: assignedSfuId: ', assignedSfuId);
        console.info('/meeting: assignedSignalingServerUrl: ', assignedSignalingServerUrl);
        
        return { assignedSfuId, assignedSignalingServerUrl };
    } catch (error) {
        console.warn('/meeting: Redis timeout or error getting assignments:', error.message);
        return { assignedSfuId: null, assignedSignalingServerUrl: null };
    }
}

// Create a new meeting
router.post('/create', async (req, res) => {
    const { MeetingName } = req.body;
    const userId = req.user.userId; // Get userId from authenticated user
    
    if (!userId) {
        console.error('userId is required.');
        return res.status(400).json({ error: 'userId is required.' });
    }

    if (!MeetingName) {
        console.error('MeetingName is required.');
        return res.status(400).json({ error: 'MeetingName is required.' });
    }

    console.log("Creating meeting with name: ", MeetingName);
    console.log("userId from token: ", userId);

    try {
        // Create the meeting
        const meetingInfo = await createMeeting(MeetingName, userId);
        const meetingId = meetingInfo.id;

        console.info(`/meeting/create: MeetingID: ${meetingId}`);
        console.info('/meeting/create: Adding participant to meeting');
        await addParticipantToMeeting(meetingId, userId);

        console.info('/meeting/create: Added participant to meeting with MeetingID: ', meetingId, ' and userId: ', userId);

        // Assign SFU and signaling server
        const { assignedSfuId, assignedSignalingServerUrl } = await assignMeetingResources(meetingId);

        console.log(`/meeting/create: Meeting ${meetingId} assigned SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}`);

        console.info('/meeting/create: Returning meeting information');
        return res.status(201).json({ 
            message: 'Meeting created successfully', 
            meetingID: String(meetingId),
            meetingCode: meetingInfo.meeting_code, // Also return the meeting code for reference
            sfu: assignedSfuId,
            signalingServer: assignedSignalingServerUrl
        });

    } catch (error) {
        console.error(`Path: ${process.env.BASE_URL || ''}/meeting/create, Unexpected error:`, error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Join an existing meeting
router.post('/join', async (req, res) => {
    const { meetingId } = req.body;
    const userId = req.user.userId; // Get userId from authenticated user
    
    if (!userId) {
        console.error('userId is required.');
        return res.status(400).json({ error: 'userId is required.' });
    }

    if (!meetingId) {
        console.error('meetingId is required.');
        return res.status(400).json({ error: 'meetingId is required.' });
    }

    console.log("Joining meeting: ", meetingId);
    console.log("userId from token: ", userId);

    try {
        // First, try to find the meeting by database ID (what /create returns)
        console.log('/meeting/join: Querying database for meeting by ID:', meetingId);
        let { data: meeting, error: meetingError } = await supabase
            .from('meetings')
            .select('id, title, meeting_code')
            .eq('id', meetingId)
            .single();


        console.log('/meeting/join: Database response - data:', meeting, 'error:', meetingError);

        if (meetingError || !meeting) {
            console.error('/meeting/join: Meeting not found by ID or meeting code:', meetingId);
            return res.status(404).json({ error: 'Meeting not found. Please check the meeting ID.' });
        }

        console.info('/meeting/join: Found meeting:', meeting.title, 'with ID:', meeting.id, 'and meeting code:', meeting.meeting_code);

        // Add participant to existing meeting (use database ID)
        await addParticipantToMeeting(meeting.id, userId);
        console.info('/meeting/join: Added participant to meeting with MeetingID: ', meeting.id, ' and userId: ', userId);

        // Get existing assignments or assign new ones if needed
        let { assignedSfuId, assignedSignalingServerUrl } = await getMeetingAssignments(meeting.id);

        if (!assignedSfuId || !assignedSignalingServerUrl) {
            console.log('/meeting/join: No existing assignments found, assigning new resources');
            const assignments = await assignMeetingResources(meeting.id);
            assignedSfuId = assignments.assignedSfuId;
            assignedSignalingServerUrl = assignments.assignedSignalingServerUrl;
        } else {
            console.log(`/meeting/join: Using existing assignments - SFU: ${assignedSfuId}, Signaling: ${assignedSignalingServerUrl}`);
        }

        // Use the meeting data we already fetched
        const meetingName = meeting.title;

        console.info('/meeting/join: Returning meeting information');
        return res.status(200).json({ 
            message: 'Successfully joined meeting', 
            meetingID: String(meeting.id), // Return the database ID to match /create response
            meetingCode: meeting.meeting_code, // Also return the meeting code for reference
            meetingName: meetingName,
            sfu: assignedSfuId,
            signalingServer: assignedSignalingServerUrl
        });

    } catch (error) {
        console.error(`Path: ${process.env.BASE_URL || ''}/meeting/join, Unexpected error:`, error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;