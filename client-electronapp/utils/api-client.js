class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.isRefreshing = false;
        this.failedQueue = [];
    }

    // Process the queue of failed requests
    processQueue(error, token = null) {
        this.failedQueue.forEach(promise => {
            if (error) {
                promise.reject(error);
            } else {
                promise.resolve(token);
            }
        });
        this.failedQueue = [];
    }

    // Get current access token
    getAccessToken() {
        return localStorage.getItem('access_token');
    }

    // Refresh token function
    async refreshToken() {
        try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                throw new Error('No refresh token available');
            }

            const response = await fetch(`${this.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refreshToken }),
            });

            if (!response.ok) {
                window.location.href = '/auth/signin';
                throw new Error('Token refresh failed');
            }

            const data = await response.json();
            localStorage.setItem('access_token', data.accessToken);
            localStorage.setItem('refresh_token', data.refreshToken);
            
            return data.accessToken;
        } catch (error) {
            // Clear tokens and redirect to login
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            window.location.href = '/auth/signin';
            throw error;
        }
    }

    // Main fetch method with automatic token refresh
    async fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        
        // Prepare headers with authorization and content type
        const token = this.getAccessToken();
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers,
            });

            // If unauthorized and we have a refresh token, try to refresh
            if (response.status === 401 && this.getAccessToken()) {
                if (this.isRefreshing) {
                    // If already refreshing, queue this request
                    return new Promise((resolve, reject) => {
                        this.failedQueue.push({ resolve, reject });
                    }).then(token => {
                        options.headers['Authorization'] = `Bearer ${token}`;
                        return fetch(url, options);
                    });
                }

                this.isRefreshing = true;

                try {
                    const newToken = await this.refreshToken();
                    this.processQueue(null, newToken);
                    
                    // Retry the original request with new token
                    options.headers['Authorization'] = `Bearer ${newToken}`;
                    return fetch(url, options);
                } catch (error) {
                    this.processQueue(error, null);
                    throw error;
                } finally {
                    this.isRefreshing = false;
                }
            }

            return response;
        } catch (error) {
            throw error;
        }
    }

    // Convenience methods
    async get(endpoint, options = {}) {
        return this.fetch(endpoint, { ...options, method: 'GET' });
    }

    async post(endpoint, data, options = {}) {
        return this.fetch(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async put(endpoint, data, options = {}) {
        return this.fetch(endpoint, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async delete(endpoint, options = {}) {
        return this.fetch(endpoint, { ...options, method: 'DELETE' });
    }
}

// Create singleton instance
// Use the same Docker URL as in your helper.js
const apiClient = new ApiClient('http://localhost:8081');

export default apiClient;
