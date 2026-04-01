/**
 * SicKloT API Connection Configuration
 * 
 * IMPORTANT: If you want anyone in the world to be able to register, 
 * you MUST change 'BACKEND_URL' below to the public link of your Node.js hosting!
 * 
 * Example: const BACKEND_URL = "https://siklot-backend.onrender.com";
 */
const BACKEND_URL = ""; // PASTE YOUR NEW HOSTING LINK HERE 

window.getApiUrl = function(path) {
    // If you are testing safely on your computer, always bounce it to port 3000
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') {
        return 'http://localhost:3000' + path;
    }
    
    // If you are on a phone on the same WiFi (e.g. 192.168.x.x)
    if (window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.0.')) {
        return 'http://' + window.location.hostname + ':3000' + path;
    }

    // If anyone accessed this from the public internet (Netlify / Phone on 5G)
    // Send it to your permanently hoisted server!
    return BACKEND_URL + path;
};
