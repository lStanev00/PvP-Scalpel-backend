let cachedToken = null;
let tokenExpiry = 0;

export function setToken(token, expiresIn) {
    cachedToken = token;
    tokenExpiry = Date.now() + expiresIn * 1000 - 60000; // Refresh 1 min before expiry
}

export function getToken() {
    if (cachedToken && tokenExpiry > Date.now()) {
        return cachedToken;
    }
    return null;
}
