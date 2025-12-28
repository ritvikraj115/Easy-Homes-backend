const axios = require('axios');

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  // Default to India code if 10 digits
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
  // Assume already contains country code
  return digits;
}

async function sendWhatsAppText(toPhone, message) {
  try {
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      console.log('ℹ️ WhatsApp disabled; skipping send.');
      return { skipped: true };
    }
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      console.warn('⚠️ WhatsApp credentials missing; skipping.');
      return { skipped: true };
    }

    const to = normalizePhone(toPhone);
    if (!to) throw new Error('Invalid recipient phone');

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message }
    };

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ WhatsApp message sent:', res.data);
    return { success: true, data: res.data };
  } catch (err) {
    console.error('❌ WhatsApp send failed:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendWhatsAppText };
