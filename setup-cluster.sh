#!/bin/bash

# Redis Cluster Auto-Setup Script
# This script automatically sets up a Redis cluster when containers start

set -e

echo "Starting Redis cluster setup..."

# Wait for all Redis nodes to be ready
echo "Waiting for Redis nodes to be ready..."
for i in {1..6}; do
    until redis-cli -h redis-node-$i ping > /dev/null 2>&1; do
        echo "Waiting for redis-node-$i..."
        sleep 2
    done
    echo "redis-node-$i is ready"
done

# Check if cluster is already formed
echo "Checking if cluster is already formed..."
if redis-cli -h redis-node-1 cluster info | grep -q "cluster_state:ok"; then
    echo "Cluster is already formed and healthy"
    exit 0
fi

# Get IP addresses of all nodes
echo "Getting node IP addresses..."
NODE_IPS=""
for i in {1..6}; do
    IP=$(getent hosts redis-node-$i | awk '{ print $1 }')
    if [ -z "$IP" ]; then
        echo "Could not resolve IP for redis-node-$i"
        exit 1
    fi
    NODE_IPS="$NODE_IPS $IP:6379"
done

echo "Node IPs: $NODE_IPS"

# Create the cluster
echo "Creating Redis cluster..."
redis-cli --cluster create $NODE_IPS --cluster-replicas 1 --cluster-yes

# Wait for cluster to be ready
echo "Waiting for cluster to be ready..."
until redis-cli -h redis-node-1 cluster info | grep -q "cluster_state:ok"; do
    echo "Waiting for cluster to be ready..."
    sleep 5
done

echo "Redis cluster setup complete!"
redis-cli -h redis-node-1 cluster info
