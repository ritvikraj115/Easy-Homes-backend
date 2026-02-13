const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEBUG_PREFIX = '[zoho-bookings]';

let cachedAccessToken = null;
let cachedApiDomain = null;
let tokenExpiresAt = 0;

function isDebugEnabled() {
  const value = String(process.env.ZOHO_BOOKINGS_DEBUG || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function logDebug(step, meta) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toISOString();
  let line = `${DEBUG_PREFIX} ${stamp} ${step}`;
  if (meta === undefined) {
    console.error(line);
    writeDebugLine(line);
    return;
  }
  line = `${line} ${safeJson(meta)}`;
  console.error(line);
  writeDebugLine(line);
}

function maskSecret(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 10) return '***';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function maskPhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

function writeDebugLine(line) {
  const filePath = process.env.ZOHO_BOOKINGS_DEBUG_FILE;
  if (!filePath) return;
  try {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, `${line}\n`, 'utf8');
  } catch (error) {
    console.error(`${DEBUG_PREFIX} file_log_failed ${error.message}`);
  }
}

function isEnabled() {
  return String(process.env.ZOHO_BOOKINGS_ENABLED || '').toLowerCase() === 'true';
}

function getAllowedProjects() {
  const raw = process.env.ZOHO_BOOKINGS_PROJECTS;
  if (!raw) return null;
  const list = raw
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

function isProjectAllowed(project) {
  const allowed = getAllowedProjects();
  if (!allowed) return true;
  if (!project) return false;
  return allowed.includes(String(project).trim().toLowerCase());
}

function ensureConfig() {
  if (!process.env.ZOHO_BOOKINGS_SERVICE_ID) {
    throw new Error('Missing Zoho Bookings env var: ZOHO_BOOKINGS_SERVICE_ID');
  }

  if (!process.env.ZOHO_BOOKINGS_STAFF_ID && !process.env.ZOHO_BOOKINGS_RESOURCE_ID && !process.env.ZOHO_BOOKINGS_GROUP_ID) {
    throw new Error('Zoho Bookings requires one of ZOHO_BOOKINGS_STAFF_ID, ZOHO_BOOKINGS_RESOURCE_ID, or ZOHO_BOOKINGS_GROUP_ID');
  }

  const hasStaticToken = Boolean(process.env.ZOHO_BOOKINGS_ACCESS_TOKEN && process.env.ZOHO_BOOKINGS_API_DOMAIN);
  const hasRefreshFlow = Boolean(
    process.env.ZOHO_ACCOUNTS_URL &&
    process.env.ZOHO_BOOKINGS_CLIENT_ID &&
    process.env.ZOHO_BOOKINGS_CLIENT_SECRET &&
    process.env.ZOHO_BOOKINGS_REFRESH_TOKEN
  );

  if (!hasStaticToken && !hasRefreshFlow) {
    throw new Error(
      'Zoho Bookings auth config missing. Set either ' +
      'ZOHO_BOOKINGS_ACCESS_TOKEN + ZOHO_BOOKINGS_API_DOMAIN, or ' +
      'ZOHO_ACCOUNTS_URL + ZOHO_BOOKINGS_CLIENT_ID + ZOHO_BOOKINGS_CLIENT_SECRET + ZOHO_BOOKINGS_REFRESH_TOKEN'
    );
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatZohoDateTime(preferredDate, timeZone) {
  if (!preferredDate) {
    throw new Error('preferredDate is required to create a Zoho appointment');
  }

  const value = String(preferredDate).trim();
  const hasTz = /([Zz]|[+-]\d{2}:?\d{2})$/.test(value);
  const naiveMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);

  if (naiveMatch && !hasTz) {
    const [, year, month, day, hour, minute, second] = naiveMatch;
    const monthName = MONTHS[Number(month) - 1];
    if (!monthName) {
      throw new Error(`Invalid month in preferredDate: ${preferredDate}`);
    }
    return `${pad2(day)}-${monthName}-${year} ${pad2(hour)}:${pad2(minute)}:${pad2(second || '00')}`;
  }

  const date = new Date(preferredDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid preferredDate: ${preferredDate}`);
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const lookup = parts.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${lookup.day}-${lookup.month}-${lookup.year} ${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

async function refreshAccessToken() {
  const accountsUrl = String(process.env.ZOHO_ACCOUNTS_URL || '').replace(/\/$/, '');
  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_BOOKINGS_REFRESH_TOKEN,
    client_id: process.env.ZOHO_BOOKINGS_CLIENT_ID,
    client_secret: process.env.ZOHO_BOOKINGS_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  const url = `${accountsUrl}/oauth/v2/token`;
  logDebug('auth.refresh.start', {
    url,
    hasRefreshToken: Boolean(process.env.ZOHO_BOOKINGS_REFRESH_TOKEN),
    hasClientId: Boolean(process.env.ZOHO_BOOKINGS_CLIENT_ID),
    hasClientSecret: Boolean(process.env.ZOHO_BOOKINGS_CLIENT_SECRET)
  });

  const response = await axios.post(url, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  logDebug('auth.refresh.success', {
    status: response.status,
    hasAccessToken: Boolean(response.data?.access_token),
    apiDomain: response.data?.api_domain || null,
    expiresIn: response.data?.expires_in || null
  });

  const { access_token: accessToken, api_domain: apiDomain, expires_in: expiresIn } = response.data || {};
  if (!accessToken) {
    throw new Error('Zoho token refresh failed: access_token missing in response');
  }

  cachedAccessToken = accessToken;
  cachedApiDomain = apiDomain || process.env.ZOHO_BOOKINGS_API_DOMAIN || null;
  if (!cachedApiDomain) {
    throw new Error('Zoho token refresh failed: api_domain missing and ZOHO_BOOKINGS_API_DOMAIN not set');
  }

  const expiresInMs = Number(expiresIn || 0) * 1000;
  tokenExpiresAt = Date.now() + Math.max(expiresInMs - 60_000, 60_000);

  return {
    accessToken: cachedAccessToken,
    apiDomain: cachedApiDomain,
    authMode: 'refresh_token'
  };
}

async function getAccessToken() {
  const hasRefreshFlow = Boolean(
    process.env.ZOHO_ACCOUNTS_URL &&
    process.env.ZOHO_BOOKINGS_CLIENT_ID &&
    process.env.ZOHO_BOOKINGS_CLIENT_SECRET &&
    process.env.ZOHO_BOOKINGS_REFRESH_TOKEN
  );

  if (hasRefreshFlow) {
    if (cachedAccessToken && Date.now() < tokenExpiresAt) {
      logDebug('auth.cached_token', {
        apiDomain: cachedApiDomain,
        expiresAt: new Date(tokenExpiresAt).toISOString()
      });
      return { accessToken: cachedAccessToken, apiDomain: cachedApiDomain, authMode: 'refresh_token_cached' };
    }
    return refreshAccessToken();
  }

  if (process.env.ZOHO_BOOKINGS_ACCESS_TOKEN) {
    const apiDomain = process.env.ZOHO_BOOKINGS_API_DOMAIN;
    if (!apiDomain) {
      throw new Error('ZOHO_BOOKINGS_API_DOMAIN is required when using ZOHO_BOOKINGS_ACCESS_TOKEN');
    }
    const accessToken = process.env.ZOHO_BOOKINGS_ACCESS_TOKEN;
    logDebug('auth.static_token', {
      apiDomain,
      token: maskSecret(accessToken)
    });
    return { accessToken, apiDomain, authMode: 'static_token' };
  }

  throw new Error('Unable to get Zoho access token: refresh flow and static token are both unavailable');
}

function buildCustomerDetails({ name, email, phone }) {
  const details = {
    name: String(name || '').trim(),
    phone_number: String(phone || '').trim()
  };
  if (email) {
    details.email = String(email).trim();
  }
  return details;
}

function buildNotes({ project, notes, pickupMode, pickupLat, pickupLng }) {
  const noteLines = [];
  if (project) noteLines.push(`Project: ${project}`);
  if (pickupMode) noteLines.push(`Pickup mode: ${pickupMode}`);
  if (Number.isFinite(Number(pickupLat)) && Number.isFinite(Number(pickupLng))) {
    noteLines.push(`Pickup coordinates: ${Number(pickupLat)}, ${Number(pickupLng)}`);
  }
  if (notes) noteLines.push(`Notes: ${notes}`);
  if (!noteLines.length) return null;
  return noteLines.join('\n');
}

function normalizeTransportRequired(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'no' || text === 'false' || text === '0') return 'No';
  return 'Yes';
}

function isCoordinatePair(value) {
  return /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(String(value || '').trim());
}

function parsePickupAddress(pickupAddress, pickupLat, pickupLng) {
  const rawText = String(pickupAddress || '').trim();
  const fallbackFromCoordinates = Number.isFinite(Number(pickupLat)) && Number.isFinite(Number(pickupLng))
    ? `Selected location near ${Number(pickupLat).toFixed(6)}, ${Number(pickupLng).toFixed(6)}`
    : null;
  const addressText = (rawText || fallbackFromCoordinates || 'Pickup address not provided').replace(/\s+/g, ' ').trim();

  if (/^selected location near/i.test(addressText)) {
    return {
      addr_1: addressText,
      addr_2: '',
      city: '',
      state: '',
      country: 'India',
      postal: ''
    };
  }

  if (isCoordinatePair(addressText)) {
    return {
      addr_1: `Selected location near ${addressText}`,
      addr_2: '',
      city: '',
      state: '',
      country: 'India',
      postal: ''
    };
  }

  const parts = addressText
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  let postalCode = '';
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const match = parts[index].match(/\b(\d{6})\b/);
    if (match) {
      postalCode = match[1];
      parts[index] = parts[index].replace(match[0], '').trim();
      if (!parts[index]) {
        parts.splice(index, 1);
      }
      break;
    }
  }

  let country = '';
  if (parts.length && /india|bharat/i.test(parts[parts.length - 1])) {
    country = parts.pop();
  } else {
    country = 'India';
  }

  const state = parts.length >= 2 ? parts.pop() : '';
  const city = parts.length >= 1 ? parts.pop() : '';
  const addr_1 = parts.length ? parts.shift() : addressText;
  const addr_2 = parts.length ? parts.join(', ') : '';

  return {
    addr_1,
    addr_2,
    city,
    state,
    country,
    postal: postalCode
  };
}

function looksLikeCreatedAppointment(returnValue) {
  if (!returnValue || typeof returnValue !== 'object') return false;
  return Boolean(
    returnValue.booking_id ||
    returnValue.summary_url ||
    returnValue.customer_booking_start_time ||
    returnValue.iso_start_time ||
    returnValue.start_time
  );
}

function isCreateAppointmentFailure(returnValue) {
  if (!returnValue || typeof returnValue !== 'object') return false;

  const status = String(returnValue.status || '').trim().toLowerCase();
  const message = String(returnValue.message || '').trim().toLowerCase();
  const hasCreatedRecord = looksLikeCreatedAppointment(returnValue);

  if ((status === 'failure' || status === 'error') && !hasCreatedRecord) {
    return true;
  }

  if (!hasCreatedRecord && /(slot not found|not available|mandatory|invalid|service not found|error)/i.test(message)) {
    return true;
  }

  return false;
}

function buildAdditionalFields({ pickupAddress, pickupLat, pickupLng, transportRequired }) {
  const pickupFieldKey = process.env.ZOHO_BOOKINGS_PICKUP_ADDRESS_FIELD || 'Pickup Address';
  const transportFieldKey = process.env.ZOHO_BOOKINGS_TRANSPORT_FIELD || 'Need Transport';
  const fields = {};

  if (transportFieldKey) {
    fields[transportFieldKey] = normalizeTransportRequired(transportRequired);
  }

  if (pickupAddress || Number.isFinite(Number(pickupLat)) || Number.isFinite(Number(pickupLng))) {
    // Official Zoho format for Address custom field type.
    fields[pickupFieldKey] = parsePickupAddress(pickupAddress, pickupLat, pickupLng);
  }

  return Object.keys(fields).length ? fields : null;
}

async function createZohoAppointment({
  project,
  name,
  phone,
  email,
  preferredDate,
  transportRequired,
  notes,
  pickupAddress,
  pickupMode,
  pickupLat,
  pickupLng
}) {
  const traceId = `zb_${Date.now()}`;
  logDebug('appointment.start', {
    traceId,
    project: project || null,
    name: name || null,
    phone: maskPhone(phone),
    hasEmail: Boolean(email),
    preferredDate: preferredDate || null,
    hasNotes: Boolean(notes),
    hasPickupAddress: Boolean(pickupAddress),
    transportRequired: normalizeTransportRequired(transportRequired),
    pickupMode: pickupMode || null
  });

  if (!isEnabled()) {
    logDebug('appointment.skip.disabled', { traceId });
    return null;
  }

  if (!isProjectAllowed(project)) {
    logDebug('appointment.skip.project_filtered', {
      traceId,
      project: project || null,
      allowedProjects: getAllowedProjects()
    });
    return null;
  }

  ensureConfig();

  try {
    const { accessToken, apiDomain, authMode } = await getAccessToken();

    const form = new FormData();
    const serviceId = process.env.ZOHO_BOOKINGS_SERVICE_ID;
    form.append('service_id', serviceId);

    let assigneeType = null;
    let assigneeId = null;
    if (process.env.ZOHO_BOOKINGS_STAFF_ID) {
      assigneeType = 'staff_id';
      assigneeId = process.env.ZOHO_BOOKINGS_STAFF_ID;
      form.append('staff_id', assigneeId);
    } else if (process.env.ZOHO_BOOKINGS_RESOURCE_ID) {
      assigneeType = 'resource_id';
      assigneeId = process.env.ZOHO_BOOKINGS_RESOURCE_ID;
      form.append('resource_id', assigneeId);
    } else if (process.env.ZOHO_BOOKINGS_GROUP_ID) {
      assigneeType = 'group_id';
      assigneeId = process.env.ZOHO_BOOKINGS_GROUP_ID;
      form.append('group_id', assigneeId);
    }

    const timeZone = process.env.ZOHO_BOOKINGS_TIMEZONE;
    const fromTime = formatZohoDateTime(preferredDate, timeZone);
    form.append('from_time', fromTime);

    if (timeZone) {
      form.append('timezone', timeZone);
    }

    const customerDetails = buildCustomerDetails({ name, email, phone });
    form.append('customer_details', JSON.stringify(customerDetails));

    const additionalFields = buildAdditionalFields({
      pickupAddress,
      pickupLat,
      pickupLng,
      transportRequired
    });
    if (additionalFields) {
      form.append('additional_fields', JSON.stringify(additionalFields));
    }

    const noteText = buildNotes({ project, notes, pickupMode, pickupLat, pickupLng });
    if (noteText) {
      form.append('notes', noteText);
    }

    const url = `${String(apiDomain).replace(/\/$/, '')}/bookings/v1/json/appointment`;
    logDebug('appointment.request', {
      traceId,
      url,
      authMode,
      token: maskSecret(accessToken),
      payload: {
        service_id: serviceId,
        [assigneeType]: assigneeId,
        from_time: fromTime,
        timezone: timeZone || null,
        customer_details: customerDetails,
        additional_fields: additionalFields || null,
        notes: noteText || null
      }
    });

    const response = await axios.post(url, form, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        ...form.getHeaders()
      },
      timeout: 20000
    });

    logDebug('appointment.success', {
      traceId,
      status: response.status,
      data: response.data
    });

    const responseStatus = String(response.data?.response?.status || '').toLowerCase();
    if (responseStatus && responseStatus !== 'success') {
      const error = new Error(`Zoho Bookings response status: ${responseStatus}`);
      error.code = 'ZOHO_BOOKING_FAILED';
      error.details = response.data?.response || response.data || null;
      throw error;
    }

    const returnValue = response.data?.response?.returnvalue || {};
    if (isCreateAppointmentFailure(returnValue)) {
      const message = returnValue.message || 'Zoho Bookings rejected appointment payload';
      const error = new Error(message);
      error.code = 'ZOHO_BOOKING_FAILED';
      error.details = returnValue;
      throw error;
    }

    return response.data;
  } catch (error) {
    console.error(`${DEBUG_PREFIX} appointment.failed ${error.message}`);
    logDebug('appointment.error', {
      traceId,
      message: error.message,
      code: error.code || null,
      status: error.response?.status || null,
      data: error.response?.data || null,
      details: error.details || null
    });
    throw error;
  }
}

module.exports = {
  createZohoAppointment
};
