const axios = require('axios');

function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

/**
 * Send Site Visit Request template
 * Template name: sitevisitreq
 * Language: en
 * Variable:
 *   {{1}} -> date
 */
async function sendSiteVisitTemplate(toPhone, date) {
  console.log('📨 sendSiteVisitTemplate called');

  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    console.log(date);
    console.log('🔐 Token present:', !!token);
    console.log('📞 Phone Number ID:', phoneNumberId);

    if (!token || !phoneNumberId) {
      throw new Error('Missing WhatsApp credentials');
    }

    const to = normalizePhone(toPhone);
    console.log('➡️ Raw phone:', toPhone);
    console.log('➡️ Normalized phone:', to);

    if (!to) {
      throw new Error('Invalid phone number');
    }

    console.log('📅 Template date param:', date);

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'sitevisit',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
          }
        ]
      }
    };

    console.log('📦 Payload being sent to Meta:');
    console.log(JSON.stringify(payload, null, 2));

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    console.log('🌍 Request URL:', url);

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log('✅ META RESPONSE STATUS:', response.status);
    console.log('✅ META RESPONSE DATA:', JSON.stringify(response.data, null, 2));

    if (response.data?.messages?.[0]?.message_status === 'accepted') {
      console.log('🎯 Meta ACCEPTED the template');
      console.log('⚠️ Delivery now depends on WhatsApp backend, billing, quality & recipient opt-in');
    }

    return response.data;

  } catch (err) {
    console.error('❌ WhatsApp TEMPLATE SEND FAILED');

    if (err.response) {
      console.error('🚫 STATUS:', err.response.status);
      console.error('🚫 RESPONSE DATA:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('🔥 ERROR MESSAGE:', err.message);
    }

    throw err; // rethrow so calling code can handle it
  }
}

module.exports = {
  sendSiteVisitTemplate
};


// const axios = require('axios');

// function normalizePhone(phone) {
//   if (!phone) return null;
//   let digits = String(phone).replace(/\D/g, '');
//   if (!digits) return null;

//   if (digits.startsWith('00')) digits = digits.slice(2);
//   if (digits.length === 10) return `91${digits}`;
//   if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
//   return digits;
// }

// /**
//  * Send NON-TEMPLATE (free text) WhatsApp message
//  * via Zoho TeamInbox API so it appears in the shared inbox.
//  *
//  * Environment variables required:
//  * - ZOHO_ACCESS_TOKEN   (Zoho OAuth access token)
//  * - ZOHO_INBOX_ID       (TeamInbox WhatsApp inbox ID)
//  *
//  * Note: Zoho enforces the 24-hour window / template rules. If outside 24hr,
//  * use a template send via Zoho (not this function).
//  */
// async function sendFreeTextMessage(toPhone, messageText) {
//   console.log('📨 sendFreeTextMessage called (via Zoho)');

//   try {
//     const zohoToken = process.env.ZOHO_ACCESS_TOKEN;
//     const inboxId = process.env.ZOHO_INBOX_ID;

//     console.log('🔐 Zoho token present:', !!zohoToken);
//     console.log('📥 Zoho inbox ID:', inboxId);

//     if (!zohoToken || !inboxId) {
//       throw new Error('Missing Zoho credentials: set ZOHO_ACCESS_TOKEN and ZOHO_INBOX_ID');
//     }

//     const to = normalizePhone(toPhone);
//     console.log('➡️ Raw phone:', toPhone);
//     console.log('➡️ Normalized phone:', to);

//     if (!to) {
//       throw new Error('Invalid phone number');
//     }

//     console.log('💬 Message text:', messageText);

//     const payload = {
//       to,
//       type: 'text',
//       text: {
//         body: String(messageText)
//       }
//     };

//     console.log('📦 Payload being sent to Zoho:');
//     console.log(JSON.stringify(payload, null, 2));

//     const url = `https://teaminbox.zoho.com/api/v1/conversations/${inboxId}/messages`;
//     console.log('🌍 Request URL:', url);

//     const response = await axios.post(url, payload, {
//       headers: {
//         Authorization: `Zoho-oauthtoken ${zohoToken}`,
//         'Content-Type': 'application/json'
//       },
//       timeout: 20000
//     });

//     console.log('✅ Zoho RESPONSE STATUS:', response.status);
//     console.log('✅ Zoho RESPONSE DATA:', JSON.stringify(response.data, null, 2));

//     // Zoho will return info including message id / conversation id
//     return response.data;

//   } catch (err) {
//     console.error('❌ ZOHO NON-TEMPLATE SEND FAILED');

//     if (err.response) {
//       console.error('🚫 STATUS:', err.response.status);
//       console.error('🚫 RESPONSE DATA:', JSON.stringify(err.response.data, null, 2));
//     } else {
//       console.error('🔥 ERROR MESSAGE:', err.message);
//     }

//     throw err;
//   }
// }

// module.exports = {
//   sendFreeTextMessage
// };







