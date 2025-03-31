export function getOptions(req) {
  const isLocalhost =
    req.headers['ga6n1fa4fcvt'] === 'EiDcafRc45$td4aedrgh4615tokenbtw';


  const options = {
    httpOnly: true,
    secure: !isLocalhost,                     
    sameSite: isLocalhost ? 'Lax' : 'None',   
    maxAge: 15 * 24 * 60 * 60 * 1000, // 15 days
    path: "/",
  };

  if (!isLocalhost) {
    options.domain = '.pvpscalpel.com';
  }

  return options;
}
