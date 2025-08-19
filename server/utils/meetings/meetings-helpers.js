const supabase = require('../datamanagement/supabase.js');
const redis = require('../datamanagement/redis.js');
const sfuRedis = redis.sfu;
const { v4: uuidv4 } = require('uuid');

async function checkMeetingExists(meetingId) {
    const { data: existingMeeting, error: checkMeetingError } = await supabase
        .from('meetings')
        .select('id, meeting_code, title')
        .eq('meeting_code', meetingId)
        .single();

    return !!existingMeeting;
}

async function createMeeting(meetingName, userId) {

    let meetingId = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    while (true) {

        meetingId = Array.from({length: 8}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');

        let meetingExists = await checkMeetingExists(meetingId);
        if (!meetingExists) {
            break;
        }
        // Generate a shorter meeting code (8 characters) with better uniqueness

    }

    const { data: meeting, error: meetingError } = await supabase
        .from('meetings')
        .insert([{ 
            host_user_id: userId,
            meeting_code: meetingId,
            title: meetingName,
            created_at: new Date().toISOString()
        }])
        .select()
        .single();

    if (meetingError) {
        console.error('Meeting creation error:', meetingError);
        throw meetingError;
    }

    return meeting;
}

async function checkParticipantExists(meetingId, userId) {
    const { data: existingParticipant, error: checkParticipantError } = await supabase
        .from('meeting_participants')
        .select('id, meeting_id, user_id')
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .single();

    return !!existingParticipant;
}

async function addParticipantToMeeting(meetingId, userId) {

    if (await checkParticipantExists(meetingId, userId)) {
        return;
    }

    console.info('addParticipantToMeeting: Adding participant to meeting with MeetingID: ', meetingId, ' and userId: ', userId);

    const { data: participant, error: participantError } = await supabase
        .from('meeting_participants')
        .insert([{
            meeting_id: meetingId,
            user_id: userId,
            joined_at: new Date().toISOString()
        }])
        .select()
        .single();

    if (participantError) {
        console.error('Participant creation error:', participantError);
        throw participantError;
    }

    return participant;
}

async function findBestSfu(availableSfuIds) {
    let bestSfuId = null;
    let minConnectedClients = Infinity;
    const healthySfuCandidates = [];

    console.info('\t\tFindBestSfu(Function Call): Here are the available SFUs from the SFU Redis: ', availableSfuIds);

    for (const sfuId of availableSfuIds) {
        console.info('\t\tFindBestSfu(Function Call): Here is the SFU ID: ', sfuId);
        const metrics = await sfuRedis.hgetall(`sfu:${sfuId}:metrics`);

        console.info(`\t\tFindBestSfu(Function Call): Here are the metrics for the SFU ${sfuId}: `, metrics);
        const connectedClients = parseInt(metrics.connected_clients || 0, 10);
        const lastHeartbeat = parseInt(metrics.last_heartbeat || 0, 10);
        const currentTime = Date.now();

        console.info(`\t\tFindBestSfu(Function Call): Here is the last heartbeat for the SFU ${sfuId}: `, lastHeartbeat);
        console.info(`\t\tFindBestSfu(Function Call): Here is the current time: `, currentTime);
        const timeSinceLastHeartbeat = currentTime - lastHeartbeat;

        console.info(`\t\tFindBestSfu(Function Call): Here is the time since last heartbeat for the SFU ${sfuId}: `, timeSinceLastHeartbeat);

        if (timeSinceLastHeartbeat < 15000) {
            healthySfuCandidates.push({ sfuId, connectedClients });
            if (connectedClients < minConnectedClients) {
                minConnectedClients = connectedClients;
                bestSfuId = sfuId;
            }
        } else {
            console.warn(`\t\tFindBestSfu(Function Call): SFU ${sfuId} is not stale. Skipping...`);
            await sfuRedis.srem('available_sfu_ids', sfuId);
            await sfuRedis.del(`sfu:${sfuId}:metrics`);
        }
    }

    if (!bestSfuId) {
        console.error('\t\tFindBestSfu(Function Call): No healthy SFUs found. Please try again later.');
        const err = new Error('No healthy SFUs found. Please try again later.');
        err.status = 503;
        throw err;
    }

    return bestSfuId;

}

async function findBestSignalingServer(availableSignalingServerUrls) {
    const healthySignalingURLS = [];
    let bestSignalingServerUrl = null;
    let minSignalingServerLoad = Infinity;

    console.info('\t\tFindBestSignalingServer(Function Call): Here are the available Signaling Servers: ', availableSignalingServerUrls);
    for (const url of availableSignalingServerUrls) {
        const urlObj = new URL(url);
        const sigServerId = urlObj.hostname + ':' + urlObj.port;
        const metrics = await redis.hgetall(`signaling:${sigServerId}:metrics`);
        console.info(`\t\tFindBestSignalingServer(Function Call): Here are the metrics for the Signaling Server ${sigServerId}: `, metrics);

        const connectedClients = parseInt(metrics.connected_clients || 0, 10);
        const lastHeartbeat = parseInt(metrics.last_heartbeat || 0, 10);
        const currentTime = Date.now();

        console.info(`\t\tFindBestSignalingServer(Function Call): Here is the last heartbeat for the Signaling Server ${sigServerId}: `, lastHeartbeat);
        console.info(`\t\tFindBestSignalingServer(Function Call): Here is the current time: `, currentTime);
        const timeSinceLastHeartbeat = currentTime - lastHeartbeat;



        if (timeSinceLastHeartbeat < 15000) {
            healthySignalingURLS.push(url, connectedClients);
            if (connectedClients < minSignalingServerLoad) {
                minSignalingServerLoad = connectedClients;
                bestSignalingServerUrl = url;
            }
        } else {
            console.warn(`\t\tFindBestSignalingServer(Function Call): Signaling Server ${sigServerId} is stale. Skipping...`);
            await redis.srem('available_signaling_servers', sigServerId);
        }
    }

    if (!bestSignalingServerUrl) {
        console.warn('No healthy Signaling Servers found. Please try again later.');
        if (availableSignalingServerUrls.length > 0) {
            bestSignalingServerUrl = availableSignalingServerUrls[nextSignalingServerIndex % availableSignalingServerUrls.length];
            nextSignalingServerIndex++
        } else {
            console.error('No Signaling Servers available. Please try again later.');
            const err = new Error('No Signaling Servers available. Please try again later.');
            err.status = 503;
            throw err;
        }
    }

    return bestSignalingServerUrl;
}

module.exports = {
    checkMeetingExists,
    createMeeting,
    checkParticipantExists,
    addParticipantToMeeting,
    findBestSfu,
    findBestSignalingServer
}