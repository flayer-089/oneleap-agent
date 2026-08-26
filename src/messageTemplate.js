function fillTemplate(template, data) {
  let filled = template;
  
  const placeholders = {
    '{{name}}': data.name || '',
    '{{designation}}': data.title || data.designation || '',
    '{{company}}': data.company || '',
    '{{industry}}': data.industry || '',
    '{{sector}}': data.sector || (Array.isArray(data.sectors) ? data.sectors.join(', ') : (data.sectors || ''))
  };
  
  for (const [placeholder, value] of Object.entries(placeholders)) {
    filled = filled.split(placeholder).join(value);
  }
  
  return filled;
}

module.exports = { fillTemplate };
