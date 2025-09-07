

set -e

echo "Starting Redis SFU cluster setup..."

echo "Waiting for Redis SFU nodes to be ready..."
for i in $(seq 1 6); do
    until redis-cli -h redis-sfu-$i ping > /dev/null 2>&1; do
        echo "Waiting for redis-sfu-$i..."
        sleep 2
    done
    echo "redis-sfu-$i is ready"
done

echo "Checking if SFU cluster is already formed..."
if redis-cli -h redis-sfu-1 cluster info | grep -q "cluster_state:ok"; then
    echo "SFU cluster is already formed and healthy"
    exit 0
fi

echo "Getting SFU node IP addresses..."
NODE_IPS=""
for i in $(seq 1 6); do
    IP=$(getent hosts redis-sfu-$i | awk '{ print $1 }')
    if [ -z "$IP" ]; then
        echo "Could not resolve IP for redis-sfu-$i"
        exit 1
    fi
    NODE_IPS="$NODE_IPS $IP:6379"
done

echo "SFU Node IPs: $NODE_IPS"

echo "Creating Redis SFU cluster..."
redis-cli --cluster create $NODE_IPS --cluster-replicas 1 --cluster-yes

echo "Waiting for SFU cluster to be ready..."
until redis-cli -h redis-sfu-1 cluster info | grep -q "cluster_state:ok"; do
    echo "Waiting for SFU cluster to be ready..."
    sleep 5
done

echo "Redis SFU cluster setup complete!"
redis-cli -h redis-sfu-1 cluster info
