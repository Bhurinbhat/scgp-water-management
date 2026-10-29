// Public runtime config for the login page and dashboard (no secrets: the anon/publishable key is meant for browsers).
// SSO turns on when the SCG IT team has registered the app in Microsoft Entra ID and enabled the Azure provider in Supabase Auth,
// then sets SSO_ENABLED=true in Vercel.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(200).json({
    ssoEnabled: process.env.SSO_ENABLED === 'true',
    provider: 'azure',
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    allowedDomains: (process.env.SSO_ALLOWED_DOMAINS || 'scg.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  });
};
