const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Get the request body
    const { shopId, qrValiditySeconds } = await req.json()
    if (!shopId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: shopId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Fetch the secret from the server environment
    const secret = Deno.env.get('QR_ACCESS_SECRET')
    if (!secret) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error: QR_ACCESS_SECRET not set on Supabase' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Generate expiry timestamp
    const validity = Number(qrValiditySeconds) || 900 // default to 15 minutes (900 seconds)
    const now = Math.floor(Date.now() / 1000)
    const expires = now + validity

    // 4. Generate random nonce
    const nonce = crypto.randomUUID()
    
    // 5. Construct payload: shopId.expires.nonce
    const payload = `${shopId}.${expires}.${nonce}`

    // 6. Compute HMAC-SHA256 signature using the web crypto API
    const encoder = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      encoder.encode(payload)
    )

    // 7. Base64url encode the signature
    const signatureBytes = new Uint8Array(signatureBuffer)
    let binary = ''
    for (let i = 0; i < signatureBytes.byteLength; i++) {
      binary += String.fromCharCode(signatureBytes[i])
    }
    const base64 = btoa(binary)
    const qrSig = base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    // 8. Return the signature components
    return new Response(
      JSON.stringify({
        expires,
        nonce,
        qrSig,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
