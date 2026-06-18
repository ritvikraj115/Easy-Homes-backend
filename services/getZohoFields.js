const axios = require('axios');

async function getZohoFields() {
  try {
    // Hardcoded credentials provided by you
    const accountsUrl = 'https://accounts.zoho.in';
    const clientId = '1000.JUKBJ5EYQ0YBJCVPZNJAKP42DUDR3J';
    const clientSecret = '5b4aa96b6829cf12062538eaa5647e5b88f9374e06';
    const refreshToken = '1000.07acf2a5c4357eb2753648d612de3397.f5606c79a3f8a237be79e57b23492d82';
    const apiDomain = 'https://www.zohoapis.in';

    console.log('Generating fresh access token using refresh logic...');

    // 1. Request a fresh Access Token
    const tokenBody = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    });

    const tokenResponse = await axios.post(`${accountsUrl}/oauth/v2/token`, tokenBody.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
        throw new Error('Refresh flow failed: No access token returned.');
    }

    console.log('✅ Token generated successfully!\n');
    console.log('Fetching field API names for the Leads module...');

    // 2. Use the fresh token to fetch the Custom Fields
    const response = await axios.get(`${apiDomain}/crm/v8/settings/fields?module=Leads`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`
      }
    });

    // 3. Filter and display the fields in a clean table
    const customFields = response.data.fields
      .filter(field => field.custom_field) // Only show custom fields
      .map(field => ({
        'Display Label': field.field_label,
        'API Name (Use this in code)': field.api_name,
        'Data Type': field.data_type
      }));

    console.table(customFields);

  } catch (error) {
    console.error('\n❌ Execution Failed:');
    console.error(error.response ? error.response.data : error.message);
  }
}

getZohoFields();