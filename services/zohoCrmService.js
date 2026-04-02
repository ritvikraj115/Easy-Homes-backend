const axios = require('axios');

const DEBUG_PREFIX = '[zoho-crm]';

let cachedAccessToken = null;
let cachedApiDomain = null;
let tokenExpiresAt = 0;

function env(primaryKey, fallbackKey) {
  return process.env[primaryKey] || (fallbackKey ? process.env[fallbackKey] : undefined);
}

function isEnabled() {
  return String(process.env.ZOHO_CRM_ENABLED || '').toLowerCase() === 'true';
}

function isStrictMode() {
  const value = String(process.env.ZOHO_CRM_STRICT || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function isDebugEnabled() {
  const value = String(process.env.ZOHO_CRM_DEBUG || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function logDebug(step, meta) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toISOString();
  if (meta === undefined) {
    console.error(`${DEBUG_PREFIX} ${stamp} ${step}`);
    return;
  }
  try {
    console.error(`${DEBUG_PREFIX} ${stamp} ${step} ${JSON.stringify(meta)}`);
  } catch {
    console.error(`${DEBUG_PREFIX} ${stamp} ${step}`);
  }
}

function maskSecret(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 10) return '***';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function hasRefreshFlow() {
  return Boolean(
    env('ZOHO_CRM_ACCOUNTS_URL', 'ZOHO_ACCOUNTS_URL') &&
    env('ZOHO_CRM_CLIENT_ID', 'ZOHO_BOOKINGS_CLIENT_ID') &&
    env('ZOHO_CRM_CLIENT_SECRET', 'ZOHO_BOOKINGS_CLIENT_SECRET') &&
    env('ZOHO_CRM_REFRESH_TOKEN', 'ZOHO_BOOKINGS_REFRESH_TOKEN')
  );
}

function hasExplicitCrmRefreshFlow() {
  return Boolean(
    process.env.ZOHO_CRM_ACCOUNTS_URL &&
    process.env.ZOHO_CRM_CLIENT_ID &&
    process.env.ZOHO_CRM_CLIENT_SECRET &&
    process.env.ZOHO_CRM_REFRESH_TOKEN
  );
}

function hasExplicitCrmStaticToken() {
  return Boolean(
    process.env.ZOHO_CRM_ACCESS_TOKEN &&
    process.env.ZOHO_CRM_API_DOMAIN
  );
}

function isUsingBookingsFallback() {
  return !hasExplicitCrmRefreshFlow() && !hasExplicitCrmStaticToken();
}

function hasStaticToken() {
  return Boolean(
    env('ZOHO_CRM_ACCESS_TOKEN', 'ZOHO_BOOKINGS_ACCESS_TOKEN') &&
    env('ZOHO_CRM_API_DOMAIN', 'ZOHO_BOOKINGS_API_DOMAIN')
  );
}

function ensureConfig() {
  if (!hasRefreshFlow() && !hasStaticToken()) {
    throw new Error(
      'Zoho CRM auth config missing. Set either ZOHO_CRM_ACCESS_TOKEN + ZOHO_CRM_API_DOMAIN, ' +
      'or ZOHO_CRM_ACCOUNTS_URL + ZOHO_CRM_CLIENT_ID + ZOHO_CRM_CLIENT_SECRET + ZOHO_CRM_REFRESH_TOKEN.'
    );
  }
}

async function refreshAccessToken() {
  const accountsUrl = String(env('ZOHO_CRM_ACCOUNTS_URL', 'ZOHO_ACCOUNTS_URL') || '').replace(/\/$/, '');
  const body = new URLSearchParams({
    refresh_token: env('ZOHO_CRM_REFRESH_TOKEN', 'ZOHO_BOOKINGS_REFRESH_TOKEN'),
    client_id: env('ZOHO_CRM_CLIENT_ID', 'ZOHO_BOOKINGS_CLIENT_ID'),
    client_secret: env('ZOHO_CRM_CLIENT_SECRET', 'ZOHO_BOOKINGS_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  });

  const response = await axios.post(`${accountsUrl}/oauth/v2/token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  const accessToken = response.data?.access_token;
  const apiDomain = response.data?.api_domain || env('ZOHO_CRM_API_DOMAIN', 'ZOHO_BOOKINGS_API_DOMAIN');
  if (!accessToken || !apiDomain) {
    throw new Error('Zoho CRM token refresh failed: missing access_token or api_domain');
  }

  cachedAccessToken = accessToken;
  cachedApiDomain = apiDomain;
  const expiresInSeconds = Number(response.data?.expires_in || 0);
  const expiresInMs = Math.max((expiresInSeconds * 1000) - 60_000, 60_000);
  tokenExpiresAt = Date.now() + expiresInMs;

  logDebug('auth.refresh.success', {
    apiDomain: cachedApiDomain,
    token: maskSecret(cachedAccessToken),
    expiresAt: new Date(tokenExpiresAt).toISOString(),
  });

  return { accessToken: cachedAccessToken, apiDomain: cachedApiDomain };
}

async function getAccessToken() {
  if (hasRefreshFlow()) {
    if (cachedAccessToken && cachedApiDomain && Date.now() < tokenExpiresAt) {
      return { accessToken: cachedAccessToken, apiDomain: cachedApiDomain };
    }
    return refreshAccessToken();
  }

  const accessToken = env('ZOHO_CRM_ACCESS_TOKEN', 'ZOHO_BOOKINGS_ACCESS_TOKEN');
  const apiDomain = env('ZOHO_CRM_API_DOMAIN', 'ZOHO_BOOKINGS_API_DOMAIN');
  if (!accessToken || !apiDomain) {
    throw new Error('Zoho CRM static token config is incomplete');
  }

  logDebug('auth.static', { apiDomain, token: maskSecret(accessToken) });
  return { accessToken, apiDomain };
}

function splitName(fullName) {
  const text = String(fullName || '').trim();
  if (!text) {
    return { firstName: '', lastName: 'Lead' };
  }
  const parts = text.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function buildLeadPayload({
  name,
  phone,
  email,
  project,
  source,
  leadStatus,
  preferredDate,
  pickupAddress,
  notes,
}) {
  const { firstName, lastName } = splitName(name);
  const company = String(
    process.env.ZOHO_CRM_DEFAULT_COMPANY ||
    `Easy Homes - ${String(project || 'Website Lead').trim()}`
  ).trim();

  const payload = {
    Last_Name: lastName || 'Lead',
    Company: company || 'Easy Homes',
    Lead_Source: String(source || 'Website').trim(),
    Phone: String(phone || '').trim(),
    Mobile: String(phone || '').trim(),
  };

  if (firstName) payload.First_Name = firstName;
  if (email) payload.Email = String(email).trim();
  if (leadStatus) payload.Lead_Status = String(leadStatus).trim();

  const descriptionBits = [];
  if (project) descriptionBits.push(`Project: ${String(project).trim()}`);
  if (preferredDate) descriptionBits.push(`Preferred Date: ${String(preferredDate).trim()}`);
  if (pickupAddress) descriptionBits.push(`Pickup Address: ${String(pickupAddress).trim()}`);
  if (notes) descriptionBits.push(`Notes: ${String(notes).trim()}`);
  if (descriptionBits.length) payload.Description = descriptionBits.join('\n');

  return payload;
}

const LEAD_STATUS_PRIORITY = Object.freeze({
  'Downloaded Brochure': 10,
  'Downloaded Layout': 10,
  'Visit Scheduled': 20,
});

function getScopeHints(moduleApiName) {
  const moduleName = String(moduleApiName || 'Leads').trim();
  const lower = moduleName.toLowerCase();
  return [
    `ZohoCRM.modules.${lower}.READ`,
    `ZohoCRM.modules.${lower}.CREATE`,
    `ZohoCRM.modules.${lower}.WRITE`,
    'ZohoCRM.modules.ALL',
  ];
}

function resolveLeadStatus(existingStatus, incomingStatus) {
  const current = String(existingStatus || '').trim();
  const next = String(incomingStatus || '').trim();

  if (!current) return next;
  if (!next) return current;

  const currentPriority = LEAD_STATUS_PRIORITY[current] || 0;
  const nextPriority = LEAD_STATUS_PRIORITY[next] || 0;
  if (nextPriority >= currentPriority) return next;
  return current;
}

function escapeCriteriaValue(rawValue) {
  return String(rawValue || '')
    .replace(/\\/g, '\\\\')
    .replace(/([(),:])/g, '\\$1');
}

function buildScopeMismatchError({ endpoint, moduleApiName, scopeHints, status, responseData }) {
  const errorCode = responseData?.code || null;
  const remediation = [
    'Generate a new Zoho CRM refresh token with CRM Leads scopes.',
    `Required scope examples: ${scopeHints.join(', ')}.`,
    'Set explicit CRM env vars: ZOHO_CRM_ACCOUNTS_URL, ZOHO_CRM_CLIENT_ID, ZOHO_CRM_CLIENT_SECRET, ZOHO_CRM_REFRESH_TOKEN.',
    isUsingBookingsFallback()
      ? 'Current setup is using Zoho Bookings OAuth fallback, which usually lacks CRM module scopes.'
      : null,
  ].filter(Boolean).join(' ');

  logDebug('lead.scope_mismatch', {
    endpoint,
    moduleApiName,
    status,
    errorCode,
    scopeHints,
    usingBookingsFallback: isUsingBookingsFallback(),
  });

  const scopeError = new Error(`Zoho CRM scope mismatch: ${remediation}`);
  scopeError.code = 'ZOHO_CRM_SCOPE_MISMATCH';
  scopeError.details = {
    status,
    response: responseData,
    scopeHints,
    usingBookingsFallback: isUsingBookingsFallback(),
  };
  return scopeError;
}

function maybeThrowScopeMismatch({ error, endpoint, moduleApiName, scopeHints }) {
  const status = Number(error?.response?.status || 0);
  const responseData = error?.response?.data || null;
  const errorCode = responseData?.code || null;
  if (status === 401 && errorCode === 'OAUTH_SCOPE_MISMATCH') {
    throw buildScopeMismatchError({
      endpoint,
      moduleApiName,
      scopeHints,
      status,
      responseData,
    });
  }
}

async function findExistingLeadByPhone({
  endpoint,
  accessToken,
  moduleApiName,
  scopeHints,
  phone,
}) {
  const rawPhone = String(phone || '').trim();
  if (!rawPhone) return null;

  const digitsOnly = rawPhone.replace(/\D/g, '');
  const candidateValues = [];
  for (const value of [rawPhone, digitsOnly]) {
    if (value && !candidateValues.includes(value)) {
      candidateValues.push(value);
    }
  }

  const searchEndpoint = `${endpoint}/search`;
  const attempts = [];
  for (const value of candidateValues) {
    attempts.push({ mode: 'phone', query: value, params: { phone: value } });
  }
  for (const value of candidateValues) {
    attempts.push({
      mode: 'criteria_phone',
      query: value,
      params: { criteria: `(Phone:equals:${escapeCriteriaValue(value)})` },
    });
  }
  for (const value of candidateValues) {
    attempts.push({
      mode: 'criteria_mobile',
      query: value,
      params: { criteria: `(Mobile:equals:${escapeCriteriaValue(value)})` },
    });
  }

  for (const attempt of attempts) {
    try {
      logDebug('lead.search.request', {
        endpoint: searchEndpoint,
        mode: attempt.mode,
        query: attempt.query,
      });

      const response = await axios.get(searchEndpoint, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        params: attempt.params,
        timeout: 20000,
      });

      const records = Array.isArray(response?.data?.data) ? response.data.data : [];
      if (!records.length) {
        logDebug('lead.search.empty', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          status: response.status,
        });
        continue;
      }

      if (records.length > 1) {
        logDebug('lead.search.duplicates_found', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          count: records.length,
        });
      }

      const firstRecord = records[0] || null;
      if (firstRecord?.id) {
        logDebug('lead.search.hit', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          id: firstRecord.id,
        });
        return firstRecord;
      }
    } catch (error) {
      maybeThrowScopeMismatch({
        error,
        endpoint: searchEndpoint,
        moduleApiName,
        scopeHints,
      });

      const status = Number(error?.response?.status || 0);
      const responseData = error?.response?.data || null;
      const errorCode = responseData?.code || null;
      const isNoContent = status === 204 || status === 404 || errorCode === 'NO_CONTENT';
      const canTryNextAttempt = status === 400 && (errorCode === 'INVALID_QUERY' || errorCode === 'INVALID_DATA');

      if (isNoContent || canTryNextAttempt) {
        logDebug('lead.search.skip_attempt', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          status,
          errorCode,
        });
        continue;
      }

      throw error;
    }
  }

  return null;
}

async function createZohoCrmLead(input) {
  if (!isEnabled()) {
    logDebug('lead.skip.disabled');
    return null;
  }

  ensureConfig();
  const { accessToken, apiDomain } = await getAccessToken();
  const moduleApiName = process.env.ZOHO_CRM_MODULE || 'Leads';
  const apiVersion = String(process.env.ZOHO_CRM_API_VERSION || 'v8').trim();
  const endpoint = `${String(apiDomain).replace(/\/$/, '')}/crm/${apiVersion}/${moduleApiName}`;
  const leadPayload = buildLeadPayload(input || {});
  const scopeHints = getScopeHints(moduleApiName);

  logDebug('lead.upsert.start', {
    endpoint,
    moduleApiName,
    payload: leadPayload,
  });

  const existingLead = await findExistingLeadByPhone({
    endpoint,
    accessToken,
    moduleApiName,
    scopeHints,
    phone: leadPayload.Phone,
  });

  if (existingLead?.id) {
    const mergedStatus = resolveLeadStatus(existingLead.Lead_Status, leadPayload.Lead_Status);
    const updatePayload = {
      id: existingLead.id,
      ...leadPayload,
    };
    if (mergedStatus) {
      updatePayload.Lead_Status = mergedStatus;
    } else {
      delete updatePayload.Lead_Status;
    }

    logDebug('lead.update.request', {
      endpoint,
      moduleApiName,
      existingId: existingLead.id,
      payload: updatePayload,
    });

    let updateResponse;
    try {
      updateResponse = await axios.put(
        endpoint,
        { data: [updatePayload] },
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );
    } catch (error) {
      maybeThrowScopeMismatch({
        error,
        endpoint,
        moduleApiName,
        scopeHints,
      });
      throw error;
    }

    const updateResult = updateResponse.data?.data?.[0];
    if (!updateResult || updateResult.status !== 'success') {
      const reason = updateResult?.message || 'Zoho CRM lead update failed';
      const error = new Error(reason);
      error.code = 'ZOHO_CRM_LEAD_UPDATE_FAILED';
      error.details = updateResponse.data || null;
      throw error;
    }

    logDebug('lead.update.success', { id: existingLead.id });
    return updateResponse.data;
  }

  logDebug('lead.create.request', {
    endpoint,
    moduleApiName,
    payload: leadPayload,
  });

  let createResponse;
  try {
    createResponse = await axios.post(
      endpoint,
      { data: [leadPayload] },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
  } catch (error) {
    maybeThrowScopeMismatch({
      error,
      endpoint,
      moduleApiName,
      scopeHints,
    });
    throw error;
  }

  const createResult = createResponse.data?.data?.[0];
  if (!createResult || createResult.status !== 'success') {
    const reason = createResult?.message || 'Zoho CRM lead creation failed';
    const error = new Error(reason);
    error.code = 'ZOHO_CRM_LEAD_FAILED';
    error.details = createResponse.data || null;
    throw error;
  }

  logDebug('lead.create.success', { id: createResult.details?.id || null });
  return createResponse.data;
}

module.exports = {
  createZohoCrmLead,
  isZohoCrmStrictMode: isStrictMode,
};
