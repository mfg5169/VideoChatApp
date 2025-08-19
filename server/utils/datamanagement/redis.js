const Redis = require('ioredis');

// Singleton pattern to ensure only one Redis connection per process
let redisInstance = null;
let sfuRedisInstance = null;

function createConnection(clusterNodesEnv, instanceName, clusterType = 'Redis') {
  try {
    // Configure Redis Cluster client
    const clusterNodes = clusterNodesEnv.split(',').map(node => {
      const [host, port] = node.split(':');
      return { host, port: parseInt(port, 10) };
    });

    const Instance_Name = instanceName;
   
    const redisInstance = new Redis.Cluster(clusterNodes, {
      // Cluster configuration options for better stability
      clusterRetryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        console.log(`${Instance_Name}: ${clusterType} Cluster retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: false, // Connect immediately
      keepAlive: 30000,
      connectTimeout: 5000, // Reduced timeout
      commandTimeout: 3000, // Reduced timeout
      enableReadyCheck: true,
      scaleReads: 'slave'
    });

    // Alternative: Single Redis instance (uncomment if cluster issues persist)
    // const redisUrl = process.env.REDIS_URL || 'redis://redis-node-1:6379';
    // redisInstance = new Redis(redisUrl, {
    //   retryDelayOnFailover: 100,
    //   maxRetriesPerRequest: 3,
    //   lazyConnect: true,
    //   keepAlive: 30000,
    //   connectTimeout: 10000,
    //   commandTimeout: 5000
    // });
    
    console.log(`${Instance_Name}: Creating ${clusterType} Cluster connection...`);
    
    let isFirstConnection = true;
    redisInstance.on('connect', () => {
      if (isFirstConnection) {
        console.log(`${Instance_Name}: Connected to ${clusterType} Cluster!`);
        isFirstConnection = false;
      } else {
        console.log(`${Instance_Name}: Reconnected to ${clusterType} Cluster`);
      }
    });
    redisInstance.on('error', (err) => {
      console.error(`${Instance_Name}: ${clusterType} Cluster error:`, err);
    });
    redisInstance.on('close', () => {
      console.log(`${Instance_Name}: ${clusterType} Cluster connection closed`);
    });
    redisInstance.on('reconnecting', () => {
      console.log(`${Instance_Name}: Reconnecting to ${clusterType} Cluster...`);
    });

    return redisInstance;
  } catch (err) {
    console.error(`Failed to initialize ${clusterType} Cluster:`, err);
    throw err;
  }
}

function createRedisConnection() {
  if (redisInstance) {
    return redisInstance;
  }

  const redisClusterNodesEnv = process.env.REDIS_CLUSTER_NODES || 'localhost:6379';
  const Instance_Name = process.env.INSTANCE_NAME || 'redis-node-1';
  
  redisInstance = createConnection(redisClusterNodesEnv, Instance_Name, 'Redis');
  return redisInstance;
}

function createSFURedisConnection() {
  if (sfuRedisInstance) {
    return sfuRedisInstance;
  }

  const sfuRedisClusterNodesEnv = process.env.REDIS_SFU_CLUSTER_NODES || 'localhost:6379';
  const Instance_Name = process.env.INSTANCE_NAME || 'orchestration-service';
  
  sfuRedisInstance = createConnection(sfuRedisClusterNodesEnv, Instance_Name, 'SFU Redis');
  return sfuRedisInstance;
}

// Export both connections
const mainRedis = createRedisConnection();
const sfuRedis = createSFURedisConnection();

module.exports = mainRedis;
module.exports.sfu = sfuRedis;
