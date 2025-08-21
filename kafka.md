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
docker exec -it kafka1 kafka-topics.sh --bootstrap-server kafka1:9092 --describe

# Check broker info
docker exec -it kafka1 kafka-broker-api-versions.sh --bootstrap-server kafka1:9092

# Check cluster ID
docker exec -it kafka1 kafka-cluster.sh --bootstrap-server kafka1:9092 --cluster-id

# Check controller info
docker exec -it kafka1 kafka-metadata-shell.sh --snapshot /tmp/kafka-logs/meta.snapshot
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
kafka-topics.sh --bootstrap-server kafka1:9092 --list

# List topics with details
kafka-topics.sh --bootstrap-server kafka1:9092 --describe

# List topics with specific pattern
kafka-topics.sh --bootstrap-server kafka1:9092 --list | grep sfu
```

### Topic Details
```bash
# Describe specific topic
kafka-topics.sh --bootstrap-server kafka1:9092 --describe --topic sfu_commands

# Show topic configuration
kafka-configs.sh --bootstrap-server kafka1:9092 --entity-type topics --entity-name sfu_commands --describe

# Show topic offsets
kafka-run-class.sh kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -1
```

### Create/Delete Topics
```bash
# Create topic
kafka-topics.sh --bootstrap-server kafka1:9092 --create --topic sfu_commands --partitions 3 --replication-factor 2

# Delete topic
kafka-topics.sh --bootstrap-server kafka1:9092 --delete --topic sfu_commands

# Alter topic partitions
kafka-topics.sh --bootstrap-server kafka1:9092 --alter --topic sfu_commands --partitions 5
```

## Message Inspection

### Consume Messages
```bash
# Consume messages from beginning
docker exec -it kafka1 kafka-console-consumer.sh --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning

# Consume messages with key
docker exec -it kafka1 kafka-console-consumer.sh --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --property print.key=true

# Consume messages with timestamp
docker exec -it kafka1 kafka-console-consumer.sh --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --property print.timestamp=true

# Consume specific partition
docker exec -it kafka1 kafka-console-consumer.sh --bootstrap-server kafka1:9092 --topic sfu_commands --partition 0 --from-beginning
```

### Produce Messages
```bash
# Produce message
kafka-console-producer.sh --bootstrap-server kafka1:9092 --topic sfu_commands

# Produce message with key
kafka-console-producer.sh --bootstrap-server kafka1:9092 --topic sfu_commands --property "parse.key=true" --property "key.separator=:"

# Example message format:
# sfu-alpha:{"event": "prepareMeeting", "payload": {"MeetingID": "meeting123"}}
```

### Message Analysis
```bash
# Get message count
kafka-run-class.sh kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -1

# Get earliest offset
kafka-run-class.sh kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -2

# Get latest offset
kafka-run-class.sh kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic sfu_commands --time -1

# Calculate lag
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --describe --group your-consumer-group
```

## Consumer Group Management

### List Consumer Groups
```bash
# List all consumer groups
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --list

# Describe consumer group
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --describe --group your-consumer-group

# Show consumer group offsets
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --describe --group your-consumer-group --offsets
```

### Reset Consumer Group
```bash
# Reset to earliest offset
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --group your-consumer-group --topic sfu_commands --reset-offsets --to-earliest --execute

# Reset to latest offset
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --group your-consumer-group --topic sfu_commands --reset-offsets --to-latest --execute

# Reset to specific offset
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --group your-consumer-group --topic sfu_commands --reset-offsets --to-offset 100 --execute
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
kafka-console-consumer.sh --bootstrap-server kafka1:9092 --topic sfu_commands --from-beginning --property print.key=true --property print.timestamp=true
```

### Check Topic Health
```bash
#!/bin/bash
echo "=== Topic Health Check ==="
TOPIC="sfu_commands"
echo "Topic: $TOPIC"
echo "Partitions:"
kafka-topics.sh --bootstrap-server kafka1:9092 --describe --topic $TOPIC
echo "Message count:"
kafka-run-class.sh kafka.tools.GetOffsetShell --bootstrap-server kafka1:9092 --topic $TOPIC --time -1
echo "Consumer groups:"
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --list | grep sfu
```

### Test Message Flow
```bash
#!/bin/bash
echo "=== Testing Message Flow ==="
TOPIC="sfu_commands"
MESSAGE='{"event": "prepareMeeting", "payload": {"MeetingID": "test-meeting-123"}}'

echo "Producing message to $TOPIC..."
echo "sfu-alpha:$MESSAGE" | kafka-console-producer.sh --bootstrap-server kafka1:9092 --topic $TOPIC --property "parse.key=true" --property "key.separator=:"

echo "Consuming messages from $TOPIC..."
timeout 10s kafka-console-consumer.sh --bootstrap-server kafka1:9092 --topic $TOPIC --from-beginning --property print.key=true --max-messages 1
```

### Check Cluster Status
```bash
#!/bin/bash
echo "=== Kafka Cluster Status ==="
echo "Brokers:"
docker ps | grep kafka
echo "Topics:"
kafka-topics.sh --bootstrap-server kafka1:9092 --list
echo "Consumer Groups:"
kafka-consumer-groups.sh --bootstrap-server kafka1:9092 --list
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
- **Example**: `{"event": "prepareMeeting", "payload": {"MeetingID": "meeting123"}}`

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
