"""
Response caching for improved performance.
"""

import hashlib
import json
import time
from typing import Optional, Dict, Any
from functools import wraps
import pickle


class ResponseCache:
    """Cache for agent responses."""
    
    def __init__(self, max_size: int = 1000, ttl: int = 3600):
        """
        Initialize response cache.
        
        Args:
            max_size: Maximum number of cached entries
            ttl: Time-to-live in seconds
        """
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.max_size = max_size
        self.ttl = ttl
        self.hits = 0
        self.misses = 0
    
    def _generate_key(self, query: str, **kwargs) -> str:
        """Generate cache key from query and kwargs."""
        # Include query and relevant kwargs in key
        key_data = {
            "query": query,
            "kwargs": {k: v for k, v in kwargs.items() if k not in ["image_paths", "video_paths"]}
        }
        key_str = json.dumps(key_data, sort_keys=True)
        return hashlib.md5(key_str.encode()).hexdigest()
    
    def get(self, query: str, **kwargs) -> Optional[Any]:
        """
        Get cached response if available.
        
        Args:
            query: User query
            **kwargs: Additional parameters
        
        Returns:
            Cached response or None
        """
        key = self._generate_key(query, **kwargs)
        
        if key in self.cache:
            entry = self.cache[key]
            
            # Check if expired
            if time.time() - entry["timestamp"] > self.ttl:
                del self.cache[key]
                self.misses += 1
                return None
            
            self.hits += 1
            return entry["response"]
        
        self.misses += 1
        return None
    
    def set(self, query: str, response: Any, **kwargs) -> None:
        """
        Cache a response.
        
        Args:
            query: User query
            response: Agent response
            **kwargs: Additional parameters
        """
        # Evict if cache is full
        if len(self.cache) >= self.max_size:
            # Remove oldest entry
            oldest_key = min(
                self.cache.keys(),
                key=lambda k: self.cache[k]["timestamp"]
            )
            del self.cache[oldest_key]
        
        key = self._generate_key(query, **kwargs)
        self.cache[key] = {
            "response": response,
            "timestamp": time.time()
        }
    
    def clear(self) -> None:
        """Clear all cached entries."""
        self.cache.clear()
        self.hits = 0
        self.misses = 0
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        total = self.hits + self.misses
        hit_rate = self.hits / total if total > 0 else 0
        
        return {
            "size": len(self.cache),
            "max_size": self.max_size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": hit_rate,
            "total_requests": total
        }


def cached(cache: ResponseCache):
    """
    Decorator to cache function results.
    
    Args:
        cache: ResponseCache instance
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate key from function name and arguments
            key_data = {
                "func": func.__name__,
                "args": str(args),
                "kwargs": kwargs
            }
            key_str = json.dumps(key_data, sort_keys=True)
            cache_key = hashlib.md5(key_str.encode()).hexdigest()
            
            # Check cache
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                return cached_result
            
            # Call function
            result = func(*args, **kwargs)
            
            # Cache result
            cache.set(cache_key, result)
            
            return result
        
        return wrapper
    return decorator


# Global cache instance
default_cache = ResponseCache(max_size=1000, ttl=3600)

