import dotenv from 'dotenv';
import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz';

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;

const buildHeaders = async () => {
    let accessToken = await helpFetch.getAccessToken(clientId, clientSecret);

    const headers = {
        headers: {
          Authorization: `Bearer ${accessToken}`, 
          'Cache-Control': 'no-cache',  
          'Pragma': 'no-cache',
        },
    }

}