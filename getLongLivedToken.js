require('dotenv').config();
const axios = require('axios');

const APP_ID = process.env.APP_ID; 
const APP_SECRET = process.env.APP_SECRET;
const SHORT_TOKEN = process.env.SHORT_TOKEN; // твой короткий токен из Graph API Explorer

async function getLongLivedToken() {
  try {
    const response = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: SHORT_TOKEN,
      },
    });

    console.log('✅ Long-Lived User Token:', response.data.access_token);
    console.log('⏳ Expires in:', response.data.expires_in, 'seconds');
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

getLongLivedToken();
