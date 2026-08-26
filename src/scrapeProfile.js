// Scrapes the full person profile ("About me" section) from the person page.
// Confirmed structure: labels are <div class="style__Name-sc-...">Label</div>
// with the value in the immediately-following sibling element.

async function scrapeProfile(page) {
  const data = {
    name: '',
    title: '',
    company: '',
    type: '',
    seniorityLevel: '',
    companyIdentity: '',
    companyIndustry: '',
    industry: '',
    sectors: [],
    companyHQ: '',
    department: '',
    country: ''
  };

  try {
    const result = await page.evaluate(() => {
      const out = { name: '', title: '', company: '' };

      // Header: name (h1/h2), then job title / organization paragraphs
      out.name =
        document.querySelector('h1')?.textContent?.trim() ||
        document.querySelector('h2')?.textContent?.trim() ||
        document.querySelector('[class*="sub-heading"]')?.textContent?.trim() ||
        '';
      const bodies = Array.from(document.querySelectorAll('[class*="body"]'))
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      out.title = bodies[0] || '';
      out.company = bodies[1] || '';

      // About-me label/value pairs: labels carry class "style__Name"
      const fields = {};
      const labelEls = Array.from(document.querySelectorAll('[class*="style__Name"]'));
      for (const el of labelEls) {
        const label = (el.textContent || '').trim();
        const valueEl = el.nextElementSibling;
        fields[label] = valueEl ? valueEl.textContent.trim() : '';
      }

      // Sector(s) chips
      let sectors = [];
      const secLabel = labelEls.find((el) => (el.textContent || '').trim() === 'Sector(s)');
      if (secLabel) {
        const container = secLabel.nextElementSibling;
        if (container) {
          // Individual chips are leaf elements (text-only, no element children).
          // Querying by class is unreliable here because wrappers like "tags"
          // also match [class*="tag"], pulling in the whole concatenated blob.
          let chips = Array.from(container.querySelectorAll('*'))
            .filter((el) => el.children.length === 0 && (el.textContent || '').trim())
            .map((el) => el.textContent.trim())
            .filter(Boolean);

          chips = [...new Set(chips)];

          if (!chips.length) {
            chips = container.textContent.trim().split(/\n+/).map((s) => s.trim()).filter(Boolean);
          }

          sectors = chips;
        }
      }

      return { ...out, fields, sectors };
    }).catch(() => null);

    if (result) {
      data.name = result.name;
      data.title = result.title;
      data.company = result.company;
      const f = result.fields || {};
      data.type = f['Type'] || '';
      data.seniorityLevel = f['Level Of Seniority'] || '';
      data.companyIdentity = f['Company Identity'] || '';
      data.companyIndustry = f['Company Industry'] || '';
      data.companyHQ = f['Company HQ'] || '';
      data.department = f['Department'] || '';
      data.country = f['Country'] || '';
      data.sectors = result.sectors || [];
      // No dedicated "Industry" field exists on the profile; use Company Industry.
      data.industry = data.companyIndustry;
    }
  } catch (error) {
    console.log(`[SCRAPE_PROFILE] Error: ${error.message}`);
  }

  return data;
}

module.exports = { scrapeProfile };
