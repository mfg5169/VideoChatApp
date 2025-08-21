
set -e

echo "Starting Redis cluster setup..."

echo "Waiting for Redis nodes to be ready..."
for i in $(seq 1 6); do
    until redis-cli -h redis-node-$i ping > /dev/null 2>&1; do
        echo "Waiting for redis-node-$i..."
        sleep 2
    done
    echo "redis-node-$i is ready"
done

echo "Checking if cluster is already formed..."
if redis-cli -h redis-node-1 cluster info | grep -q "cluster_state:ok"; then
    echo "Cluster is already formed and healthy"
    exit 0
fi

echo "Getting node IP addresses..."
NODE_IPS=""
for i in $(seq 1 6); do
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
