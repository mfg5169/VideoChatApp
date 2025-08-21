# Redis Debugging & Monitoring Guide

## Table of Contents
- [Cluster Status Commands](#cluster-status-commands)
- [Data Inspection Commands](#data-inspection-commands)
- [Connection & Network Commands](#connection--network-commands)
- [Performance & Monitoring](#performance--monitoring)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Useful Scripts](#useful-scripts)

## Cluster Status Commands

### Check Cluster Health
```bash
# Check cluster nodes and their status
docker exec -it redis-node-1 redis-cli -p 6379 cluster nodes

# Check cluster info
docker exec -it redis-node-1 redis-cli -p 6379 cluster info

# Check cluster slots distribution
docker exec -it redis-node-1 redis-cli -p 6379 cluster slots

# Check if cluster is ready
docker exec -it redis-node-1 redis-cli -p 6379 cluster info | grep cluster_state
```

### SFU Cluster Specific
```bash
# Check SFU cluster nodes
docker exec -it redis-sfu-1 redis-cli -p 6379 cluster nodes

# Check SFU cluster info
docker exec -it redis-sfu-1 redis-cli -p 6379 cluster info

# Check SFU cluster slots
docker exec -it redis-sfu-1 redis-cli -p 6379 cluster slots
```

## Data Inspection Commands

### Check Available SFUs
```bash
# Check available SFUs in SFU cluster
docker exec -it redis-sfu-1 redis-cli -p 6379 SMEMBERS available_sfus

# Check SFU count
docker exec -it redis-sfu-1 redis-cli -p 6379 SCARD available_sfus

# Check if specific SFU exists
docker exec -it redis-sfu-1 redis-cli -p 6379 SISMEMBER available_sfus sfu-alpha
```

### Check Meeting Data
```bash
# Check meeting metadata
redis-cli -h redis-node-1 -p 6379 HGETALL meeting:meeting123:metadata

# Check specific meeting fields
redis-cli -h redis-node-1 -p 6379 HGET meeting:meeting123:metadata sfu_id
redis-cli -h redis-node-1 -p 6379 HGET meeting:meeting123:metadata signaling_server_url

# Check all meeting keys
redis-cli -h redis-node-1 -p 6379 KEYS "meeting:*"
```

### Check SFU Metrics
```bash
# Check SFU metrics
redis-cli -h redis-sfu-1 -p 6379 HGETALL sfu:sfu-alpha:metrics

# Check specific metrics
redis-cli -h redis-sfu-1 -p 6379 HGET sfu:sfu-alpha:metrics connected_clients
redis-cli -h redis-sfu-1 -p 6379 HGET sfu:sfu-alpha:metrics active_meetings
redis-cli -h redis-sfu-1 -p 6379 HGET sfu:sfu-alpha:metrics last_heartbeat

# Check all SFU keys
redis-cli -h redis-sfu-1 -p 6379 KEYS "sfu:*"
```

### Check User Presence
```bash
# Check user presence
redis-cli -h redis-node-1 -p 6379 HGETALL user:user123:presence

# Check all user keys
redis-cli -h redis-node-1 -p 6379 KEYS "user:*:presence"
```

### Check Meeting Participants
```bash
# Check meeting participants
redis-cli -h redis-node-1 -p 6379 SMEMBERS meeting:meeting123:participants

# Check participant count
redis-cli -h redis-node-1 -p 6379 SCARD meeting:meeting123:participants
```

## Connection & Network Commands

### Test Connections
```bash
# Test basic connectivity
redis-cli -h redis-node-1 -p 6379 PING

# Test SFU cluster connectivity
redis-cli -h redis-sfu-1 -p 6379 PING

# Check connection info
redis-cli -h redis-node-1 -p 6379 CLIENT LIST

# Check slow queries
redis-cli -h redis-node-1 -p 6379 SLOWLOG GET 10
```

### Monitor Real-time Activity
```bash
# Monitor all Redis commands in real-time
redis-cli -h redis-node-1 -p 6379 MONITOR

# Monitor specific patterns
redis-cli -h redis-node-1 -p 6379 MONITOR | grep "meeting:"
redis-cli -h redis-node-1 -p 6379 MONITOR | grep "sfu:"
```

## Performance & Monitoring

### Memory Usage
```bash
# Check memory info
redis-cli -h redis-node-1 -p 6379 INFO memory

# Check memory usage by key
redis-cli -h redis-node-1 -p 6379 MEMORY USAGE meeting:meeting123:metadata

# Check memory stats
redis-cli -h redis-node-1 -p 6379 MEMORY STATS
```

### Database Stats
```bash
# Check database info
redis-cli -h redis-node-1 -p 6379 INFO keyspace

# Check database stats
redis-cli -h redis-node-1 -p 6379 INFO stats

# Check replication info
redis-cli -h redis-node-1 -p 6379 INFO replication
```

### Key Statistics
```bash
# Count keys by pattern
redis-cli -h redis-node-1 -p 6379 --eval - <<< "return #redis.call('keys', ARGV[1])" "meeting:*"

# Get key types
redis-cli -h redis-node-1 -p 6379 TYPE meeting:meeting123:metadata

# Get key TTL
redis-cli -h redis-node-1 -p 6379 TTL meeting:meeting123:metadata
```

## Troubleshooting Common Issues

### Cluster Down Issues
```bash
# Check cluster state
redis-cli -h redis-node-1 -p 6379 cluster info | grep cluster_state

# If cluster_state:fail, check node status
redis-cli -h redis-node-1 -p 6379 cluster nodes

# Restart cluster setup
docker-compose restart redis-cluster-setup
```

### Connection Issues
```bash
# Check if Redis is listening
netstat -tlnp | grep 6379

# Check Docker container status
docker ps | grep redis

# Check Redis logs
docker logs redis-node-1
docker logs redis-sfu-1
```

### Data Consistency Issues
```bash
# Check if data exists in both clusters
redis-cli -h redis-node-1 -p 6379 HGETALL meeting:meeting123:metadata
redis-cli -h redis-sfu-1 -p 6379 HGETALL meeting:meeting123:metadata

# Compare SFU assignments
redis-cli -h redis-node-1 -p 6379 HGET meeting:meeting123:metadata sfu_id
redis-cli -h redis-sfu-1 -p 6379 HGET meeting:meeting123:metadata sfu_id
```

## Useful Scripts

### Check All SFU Health
```bash
#!/bin/bash
echo "=== SFU Cluster Health Check ==="
redis-cli -h redis-sfu-1 -p 6379 cluster info | grep cluster_state
echo "Available SFUs:"
redis-cli -h redis-sfu-1 -p 6379 SMEMBERS available_sfus
echo "SFU Metrics:"
redis-cli -h redis-sfu-1 -p 6379 KEYS "sfu:*:metrics" | while read key; do
    echo "$key:"
    redis-cli -h redis-sfu-1 -p 6379 HGETALL "$key"
done
```

### Monitor Meeting Creation
```bash
#!/bin/bash
echo "=== Monitoring Meeting Creation ==="
redis-cli -h redis-node-1 -p 6379 MONITOR | grep -E "(meeting:|sfu:|signaling:)"
```

### Check Data Consistency
```bash
#!/bin/bash
echo "=== Data Consistency Check ==="
MEETING_ID="meeting123"
echo "Main cluster data:"
redis-cli -h redis-node-1 -p 6379 HGETALL "meeting:$MEETING_ID:metadata"
echo "SFU cluster data:"
redis-cli -h redis-sfu-1 -p 6379 HGETALL "meeting:$MEETING_ID:metadata"
```

## Environment Variables Reference

### Main Redis Cluster
```bash
REDIS_CLUSTER_NODES=redis-node-1:6379,redis-node-2:6379,redis-node-3:6379,redis-node-4:6379,redis-node-5:6379,redis-node-6:6379
```

### SFU Redis Cluster
```bash
REDIS_SFU_CLUSTER_NODES=redis-sfu-1:6379,redis-sfu-2:6379,redis-sfu-3:6379,redis-sfu-4:6379,redis-sfu-5:6379,redis-sfu-6:6379
```

## Key Patterns in Your System

### Meeting Data
- `meeting:{MeetingID}:metadata` - Meeting configuration (Hash)
- `meeting:{MeetingID}:participants` - Meeting participants (Set)

### SFU Data
- `available_sfus` - Available SFU instances (Set)
- `sfu:{sfuId}:metrics` - SFU performance metrics (Hash)

### User Data
- `user:{userId}:presence` - User presence information (Hash)

### Channels
- `sfu_commands:{sfuId}` - Commands sent to SFU (Pub/Sub)
- `sfu_signals_to_clients` - Signals from SFU to clients (Pub/Sub)
- `sfu_heartbeats` - SFU heartbeat messages (Pub/Sub)
