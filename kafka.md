# Kafka Debugging & Monitoring Guide

## Table of Contents
- [Cluster Status Commands](#cluster-status-commands)
- [Topic Management](#topic-management)
- [Message Inspection](#message-inspection)
- [Consumer Group Management](#consumer-group-management)
- [Performance & Monitoring](#performance--monitoring)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Useful Scripts](#useful-scripts)

## Cluster Status Commands

### Check Cluster Health
```bash
# Check cluster info
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --describe

# Check broker info
docker exec -it kafka1 kafka-broker-api-versions --bootstrap-server kafka1:9092

# Check cluster ID
docker exec -it kafka1 kafka-cluster --bootstrap-server kafka1:9092 --cluster-id

# Check controller info
docker exec -it kafka1 kafka-metadata-shell --snapshot /tmp/kafka-logs/meta.snapshot
```

### Check Zookeeper Status
```bash
# Connect to Zookeeper
docker exec -it zookeeper zkCli.sh

# Check Zookeeper status
echo stat | nc zookeeper 2181

# List Zookeeper nodes
docker exec -it zookeeper zkCli.sh ls /
```

## Topic Management

### List Topics
```bash
# List all topics
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --list

# List topics with details
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --describe

# List topics with specific pattern
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --list | grep sfu
```

### Topic Details
```bash
# Describe specific topic
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --describe --topic sfu_commands

# Show topic configuration
docker exec -it kafka1 kafka-configs --bootstrap-server kafka1:9092 --entity-type topics --entity-name sfu_commands --describe

# Show topic offsets
docker exec -it kafka1 kafka-run-class kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -1
```

### Create/Delete Topics
```bash
# Create topic
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --create --topic sfu_commands --partitions 3 --replication-factor 2

# Delete topic
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --delete --topic sfu_commands

# Alter topic partitions
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --alter --topic sfu_commands --partitions 5
```

## Message Inspection

### Consume Messages
```bash
# Consume messages from beginning
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning

# Consume messages with key
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --property print.key=true

# Consume messages with timestamp
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --property print.timestamp=true

# Consume specific partition
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --partition 0 --from-beginning

# Consume with max messages limit (useful for debugging)
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --max-messages 5
```

### Produce Messages
```bash
# Produce message
docker exec -it kafka1 kafka-console-producer --bootstrap-server kafka1:9092 --topic sfu_commands

# Produce message with key
docker exec -it kafka1 kafka-console-producer --bootstrap-server kafka1:9092 --topic sfu_commands --property "parse.key=true" --property "key.separator=:"

# Example message format:
# sfu-alpha:{"type": "prepareMeeting", "payload": {"meetingId": "meeting123"}}
```

### Message Analysis
```bash
# Get message count
docker exec -it kafka1 kafka-run-class kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -1

# Get earliest offset
docker exec -it kafka1 kafka-run-class kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -2

# Get latest offset
docker exec -it kafka1 kafka-run-class kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -1

# Calculate lag
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --describe --group your-consumer-group
```

## Consumer Group Management

### List Consumer Groups
```bash
# List all consumer groups
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --list

# Describe consumer group
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --describe --group your-consumer-group

# Show consumer group offsets
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --describe --group your-consumer-group --offsets

# Describe specific consumer group (e.g., sfu-group)
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --describe --group sfu-group
```

### Reset Consumer Group
```bash
# Reset to earliest offset
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --group your-consumer-group --topic sfu_commands --reset-offsets --to-earliest --execute

# Reset to latest offset
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --group your-consumer-group --topic sfu_commands --reset-offsets --to-latest --execute

# Reset to specific offset
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --group your-consumer-group --topic sfu_commands --reset-offsets --to-offset 100 --execute
```

## Performance & Monitoring

### Broker Metrics
```bash
# Check broker logs
docker logs kafka1

# Check broker JMX metrics
docker exec -it kafka1 jcmd 1 VM.metrics

# Check disk usage
docker exec -it kafka1 df -h

# Check memory usage
docker exec -it kafka1 free -h
```

### Topic Metrics
```bash
# Check topic size
kafka-log-dirs.sh --bootstrap-server kafka1:9092 --describe --topic-list sfu_commands

# Check partition sizes
kafka-log-dirs.sh --bootstrap-server kafka1:9092 --describe --topic-list sfu_commands --broker-list 1

# Check replication status
kafka-topics.sh --bootstrap-server kafka1:9092 --describe --under-replicated-partitions
```

### Network & Connectivity
```bash
# Test connectivity
telnet kafka1 9092

# Check port status
netstat -tlnp | grep 9092

# Check Docker network
docker network ls
docker network inspect webrtc-net
```

## Debugging Commands (Used in This Project)

### Check Current Topics and Messages
```bash
# List all topics
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --list

# Describe all topics with details
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --describe

# Check messages in sfu_commands topic
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --max-messages 5

# Check messages in meeting-events topic
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic meeting-events --from-beginning --max-messages 5
```

### Check Consumer Groups
```bash
# List all consumer groups
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --list

# Check sfu-group consumer details
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --describe --group sfu-group

# Check consumer lag
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --describe --group sfu-group | grep -E "(TOPIC|PARTITION|LAG)"
```

### Test Message Production
```bash
# Test producing a message to sfu_commands
echo 'sfu-alpha:{"type": "prepareMeeting", "payload": {"meetingId": "test-meeting-123"}}' | docker exec -i kafka1 kafka-console-producer --bootstrap-server kafka1:9092 --topic sfu_commands --property "parse.key=true" --property "key.separator=:"

# Test producing a message to meeting-events
echo 'meeting-123:{"event": "userJoined", "payload": {"userId": "user123", "meetingId": "meeting-123"}}' | docker exec -i kafka1 kafka-console-producer --bootstrap-server kafka1:9092 --topic meeting-events --property "parse.key=true" --property "key.separator=:"
```

### Debug Message Flow
```bash
# Monitor sfu_commands in real-time
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --property print.key=true --property print.timestamp=true

# Monitor meeting-events in real-time
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic meeting-events --property print.key=true --property print.timestamp=true
```

## Troubleshooting Common Issues

### Connection Issues
```bash
# Check if Kafka is running
docker ps | grep kafka

# Check Kafka logs
docker logs kafka1
docker logs kafka2
docker logs kafka3

# Check Zookeeper logs
docker logs zookeeper

# Restart Kafka services
docker-compose restart kafka1 kafka2 kafka3
```

### Message Production Issues
```bash
# Check producer logs
docker logs orchestration-service | grep -i kafka

# Test message production
kafka-console-producer.sh --bootstrap-server kafka1:9092 --topic test-topic <<< "test message"

# Check topic exists
kafka-topics.sh --bootstrap-server kafka1:9092 --list | grep sfu_commands
```

### Message Consumption Issues
```bash
# Check consumer logs
docker logs ion-sfu-1 | grep -i kafka

# Check consumer group status
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --describe --group sfu-consumer

# Check for lag
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --describe --group sfu-consumer | grep -E "(TOPIC|PARTITION|LAG)"
```

### Topic Issues
```bash
# Check topic configuration
kafka-configs.sh --bootstrap-server kafka1:9092 --entity-type topics --entity-name sfu_commands --describe

# Check topic partitions
kafka-topics.sh --bootstrap-server kafka1:9092 --describe --topic sfu_commands

# Check under-replicated partitions
kafka-topics.sh --bootstrap-server kafka1:9092 --describe --under-replicated-partitions
```

## Useful Scripts

### Monitor SFU Commands
```bash
#!/bin/bash
echo "=== Monitoring SFU Commands ==="
docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --property print.key=true --property print.timestamp=true
```

### Check Topic Health
```bash
#!/bin/bash
echo "=== Topic Health Check ==="
TOPIC="sfu_commands"
echo "Topic: $TOPIC"
echo "Partitions:"
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --describe --topic $TOPIC
echo "Message count:"
docker exec -it kafka1 kafka-run-class kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic $TOPIC --time -1
echo "Consumer groups:"
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --list | grep sfu
```

### Test Message Flow
```bash
#!/bin/bash
echo "=== Testing Message Flow ==="
TOPIC="sfu_commands"
MESSAGE='{"type": "prepareMeeting", "payload": {"meetingId": "test-meeting-123"}}'

echo "Producing message to $TOPIC..."
echo "sfu-alpha:$MESSAGE" | docker exec -i kafka1 kafka-console-producer --bootstrap-server kafka1:9092 --topic $TOPIC --property "parse.key=true" --property "key.separator=:"

echo "Consuming messages from $TOPIC..."
timeout 10s docker exec -it kafka1 kafka-console-consumer --bootstrap-server kafka1:9092 --topic $TOPIC --from-beginning --property print.key=true --max-messages 1
```

### Check Cluster Status
```bash
#!/bin/bash
echo "=== Kafka Cluster Status ==="
echo "Brokers:"
docker ps | grep kafka
echo "Topics:"
docker exec -it kafka1 kafka-topics --bootstrap-server kafka1:9092 --list
echo "Consumer Groups:"
docker exec -it kafka1 kafka-consumer-groups --bootstrap-server kafka1:9092 --list
echo "Zookeeper:"
docker ps | grep zookeeper
```

## Environment Variables Reference

### Kafka Configuration
```bash
KAFKA_BROKER_ID=1
KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
KAFKA_LISTENERS=PLAINTEXT://:9092
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka1:9092
KAFKA_AUTO_CREATE_TOPICS_ENABLE=true
KAFKA_DELETE_TOPIC_ENABLE=true
```

### Producer Configuration
```bash
KAFKA_BOOTSTRAP_SERVERS=kafka1:9092,kafka2:9092,kafka3:9092
KAFKA_TOPIC=sfu_commands
KAFKA_ACKS=all
KAFKA_RETRIES=3
```

## Topic Patterns in Your System

### SFU Commands Topic
- **Topic**: `sfu_commands`
- **Key**: SFU ID (e.g., `sfu-alpha`)
- **Value**: JSON command object
- **Example**: `{"type": "prepareMeeting", "payload": {"meetingId": "meeting123"}}`

### Message Types
- `prepareMeeting` - Prepare SFU for meeting
- `joinMeeting` - Join user to meeting
- `leaveMeeting` - Remove user from meeting
- `endMeeting` - End meeting

### Consumer Groups
- `sfu-consumer` - SFU service consumer group
- `orchestration-consumer` - Orchestration service consumer group

## Best Practices

### Monitoring
- Monitor consumer lag regularly
- Set up alerts for under-replicated partitions
- Monitor disk usage and memory consumption
- Track message production/consumption rates

### Troubleshooting
- Always check logs first
- Verify connectivity between services
- Check topic configuration and permissions
- Monitor consumer group health
- Verify message format and schema

### Performance
- Use appropriate partition counts
- Monitor replication factor
- Set proper retention policies
- Monitor broker resources
