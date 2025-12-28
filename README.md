Site Visit Booking API
======================

Endpoint
- POST /api/site-visits

Payload
- project: string (e.g. "Kalpavruksha")
- name: string (required)
- phone: string (required)
- email: string (optional)
- preferredDate: ISO datetime string (required)
- notes: string (optional)

Behavior
- Stores the request in MongoDB
- Emails the user (if email provided) and the admin
- Sends a WhatsApp text to the user (if WhatsApp env is configured)

Environment Variables
- ADMIN_EMAIL: Admin recipient for new requests
- SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM: Email settings
- WHATSAPP_ENABLED=true
- WHATSAPP_ACCESS_TOKEN=your_meta_graph_token
- WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id

