/* OptiHire content script (polished)
 - Implements robust profile extraction (waits & scrolls to load skills)
 - Injects sidebar and consent banner on LinkedIn profile pages
 - Injects "Match Score" button on job posts and calls backend at http://localhost:4000/api/match
 - Displays results in the sidebar
*/

const BACKEND_URL = 'http://localhost:4000/api';

const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
const delay = ms => new Promise(r => setTimeout(r, ms));
const safeText = el => el ? (el.innerText || '').trim() : '';
const isOnLinkedInProfile = () => location.hostname.includes('linkedin.com') && /\/in\//.test(location.pathname);

/* ---------------- Profile extraction (wait for lazy load of Skills) ---------------- */
async function extractProfileFromDOM(waitForSkills = true) {
  try {
    if (!isOnLinkedInProfile()) {
      throw new Error('Not on a LinkedIn profile page. Navigate to your profile (URL contains /in/).');
    }

    const name = safeText(q('.pv-text-details__left-panel h1')) || safeText(q('.text-heading-xlarge')) || safeText(q('h1')) || '';
    const title = safeText(q('.pv-text-details__left-panel .text-body-medium')) || safeText(q('.text-body-medium.break-words')) || safeText(q('.pv-top-card--list li')) || '';
    const summary = safeText(q('#about .inline-show-more-text')) || safeText(q('#about .pv-shared-text-with-see-more')) || safeText(q('.pv-about__summary-text')) || '';

    if (waitForSkills) {
      try {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        await delay(1200);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await delay(600);
      } catch (e) { /* ignore */ }
    }

    let skills = [];
    const skillSelectors = [
      'section.pv-skill-categories-section',
      'section#skills',
      'section.pv-profile-section.skills-section',
      'section.pv2-profile-section__card',
      'section[id*="skills" i]',
      'div[data-view-name*="skills" i]'
    ];
    let skillSection = null;
    for (const sel of skillSelectors) {
      skillSection = document.querySelector(sel);
      if (skillSection) break;
    }

    // Try to expand skills section (See all skills)
    try {
      const expanders = [
        'a[href*="details/skills"]',
        'button[aria-label*="skills" i]',
        'button[aria-label*="all skills" i]',
        'button[aria-label*="show more skills" i]',
        'button[aria-expanded="false"][aria-label*="skills" i]'
      ];
      for (const sel of expanders) {
        const btn = q(sel);
        if (btn) { try { btn.click(); await delay(500); } catch(e){} }
      }
    } catch(e){}

    if (skillSection) {
      const skillEls = skillSection.querySelectorAll(
        'span.pv-skill-category-entity__name-text, span.pv-skill-entity__skill-name, [data-test-skill-name], .pv-skill-entity__skill-name, .pvs-list__item span[aria-hidden="true"], .pvs-list__item .artdeco-pill__text, .skill-pill, .skills-list span'
      );
      skills = Array.from(skillEls).map(el => safeText(el)).filter(Boolean);
    }

    if (!skills || skills.length === 0) {
      // Broader containers for the new LinkedIn UI
      const containers = qa('section#skills, section[id*="skills"], section.pv-skill-categories-section, section[data-view-name*="skills"], div.pv-skill-categories-section');
      for (const c of containers) {
        const els = c.querySelectorAll('.pvs-list__item span[aria-hidden="true"], span.pv-skill-entity__skill-name, [data-test-skill-name]');
        const found = Array.from(els).map(el => safeText(el)).filter(Boolean);
        if (found.length) { skills = skills.concat(found) }
      }
    }

    if (!skills || skills.length === 0) {
      const possibleSections = Array.from(document.querySelectorAll('section')).filter(s => /\bskills\b/i.test(s.innerText));
      if (possibleSections.length) {
        const sec = possibleSections[0];
        const candidates = sec.querySelectorAll('.pvs-list__item span[aria-hidden="true"], span, li');
        skills = Array.from(candidates).map(n => safeText(n)).filter(t => t && t.length < 60);
      }
    }

    const expEls = qa('#experience-section h3, .pvs-entity__path-node span[aria-hidden="true"], .pv-entity__summary-info h3');
    const experiences = Array.from(expEls).map(n => safeText(n)).filter(Boolean);

    const certEls = qa('.certification-name, section.certifications-section span[aria-hidden="true"]');
    const certifications = Array.from(certEls).map(n => safeText(n)).filter(Boolean);

    const dedupSkills = Array.from(new Set(skills.map(s => s.replace(/\([^)]*\)/g, '').trim()))).slice(0, 60);

    const profileData = {
      name,
      title,
      summary,
      skills: dedupSkills,
      experiences: experiences.slice(0, 20),
      certifications: certifications.slice(0, 20),
      extracted_at: new Date().toISOString()
    };

    console.log('OptiHire: extracted profile ->', profileData);
    return profileData;
  } catch (err) {
    console.warn('OptiHire: extractProfileFromDOM error', err);
    throw err;
  }
}

/* ---------------- Job extraction ---------------- */
async function extractJobFromDOM() {
  try {
    // Expand job description if collapsed
    const showMoreSelectors = [
      '.show-more-less-html__button',
      'button[aria-expanded][aria-label*="more"]',
      '.jobs-description__container button',
      'button[aria-label*="See more" i]'
    ];
    for (const sel of showMoreSelectors) {
      const btns = qa(sel);
      for (const btn of btns) {
        if (/see more|show more|more/i.test(btn.innerText || btn.getAttribute('aria-label') || '')) {
          try { btn.click(); await delay(200); } catch(e){}
        }
      }
    }

    const jobTitle = safeText(q('.topcard__title, .jobs-unified-top-card__job-title, h1, [data-test-job-title]')) || '';
    const company = safeText(q('.topcard__org-name-link, .jobs-unified-top-card__company-name, .topcard__org-name, [data-test-company-name]')) || '';

    // Helper: find a description element within known job description containers only
    const containerSelectors = [
      '.jobs-description__container',
      'section.jobs-description__container',
      '[data-job-details]',
      '.jobs-details__main-content',
      '.jobs-unified-description',
      '.jobs-box__html-content',
      '.jobs-description-content',
      '[data-test-description-section]'
    ];
    let container = null;
    for (const cSel of containerSelectors) {
      const c = q(cSel);
      if (c) { container = c; break; }
    }

    // Prefer description nodes inside the container
    let descEl = null;
    if (container) {
      descEl = container.querySelector(
        '.show-more-less-html__markup, [data-test-description], .jobs-description-content__text, [data-job-details], .jobs-box__html-content, .jobs-description__content'
      );
    }

    // If still not found, allow a top-level candidate but only if it lives under a known container
    if (!descEl) {
      const candidates = qa('.show-more-less-html__markup, .jobs-description-content__text, [data-test-description], .jobs-box__html-content');
      for (const el of candidates) {
        const p = el.closest(containerSelectors.join(','));
        if (p) { descEl = el; container = p; break; }
      }
    }

    let jobDesc = '';
    if (descEl) {
      jobDesc = safeText(descEl);
    } else if (container) {
      // As a last resort, collect only text within the container (no cross-page fallback)
      const parts = [];
      const nodes = container.querySelectorAll('p, li, div');
      for (const n of nodes) {
        const t = safeText(n);
        if (t && t.length > 0) parts.push(t);
      }
      jobDesc = parts.join(' ');
    }

    // Fallback: JSON-LD JobPosting description (strip HTML)
    if (!jobDesc || jobDesc.length < 40) {
      try {
        const scripts = qa('script[type="application/ld+json"]');
        for (const s of scripts) {
          try {
            const j = JSON.parse(s.textContent || '{}');
            const isJobPosting = j && (j['@type'] === 'JobPosting' || (Array.isArray(j['@type']) && j['@type'].includes('JobPosting')));
            if (isJobPosting) {
              const raw = j.description || j.jobDescription || '';
              const clean = (raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (clean && clean.length > jobDesc.length) { jobDesc = clean; break; }
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    }

    // Final cleanup
    jobDesc = (jobDesc || '').replace(/\s+/g, ' ').trim();

    // Enforce a minimum size to avoid empty payload to backend
    if (jobDesc.length < 20) {
      console.warn('OptiHire: Job description too short after extraction');
    }

    console.log('OptiHire: extracted job ->', { jobTitle, company, jobDescSnippet: (jobDesc||'').slice(0,300)+'...' });
    return { jobTitle, company, jobDesc };
  } catch (e) {
    console.warn('OptiHire: extractJobFromDOM error', e);
    return { jobTitle: '', company: '', jobDesc: '' };
  }
}

/* ---------------- UI: sidebar + consent ---------------- */
function createSidebar() {
  if (document.getElementById('optiSidebar')) return;
  const sidebar = document.createElement('div');
  sidebar.id = 'optiSidebar';
  sidebar.innerHTML = `
    <div id="optiHeader">
      <div style="display:flex;align-items:center;gap:8px;"><div style="font-weight:600;color:#0a66c2">⚡ OptiHire</div></div>
      <div>
        <button id="optiMinimizeBtn" title="Minimize">—</button>
        <button id="optiCloseHeader" title="Close">✕</button>
      </div>
    </div>
    <div id="optiBody">
      <div id="optiProfileSection" class="section"></div>
      <div id="optiJobSection" class="section"></div>
      <div id="optiResultSection" class="section"></div>
      <div id="optiMessages" style="display:none"></div>
      <div id="optiEmpty">Open the sidebar and click "Extract Profile" while on your LinkedIn profile to save your profile locally. Then navigate to a job posting and click "Match Job".</div>
    </div>
    <div id="optiFooter">
      <div style="display:flex;gap:8px;width:100%">
        <button id="optiExtractProfile" class="optiSmallBtn">Extract Profile</button>
        <button id="optiMatchJob" class="optiPrimaryBtn">Match Job</button>
        <button id="optiCloseFooter" class="optiSmallBtn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(sidebar);

  // Start hidden by default
  sidebar.style.display = 'none';

  document.getElementById('optiCloseHeader').addEventListener('click', () => closeSidebar());
  document.getElementById('optiCloseFooter').addEventListener('click', () => closeSidebar());
  document.getElementById('optiMinimizeBtn').addEventListener('click', () => toggleMinimize());

  // Extract profile button
  document.getElementById('optiExtractProfile').addEventListener('click', async () => {
    const btn = document.getElementById('optiExtractProfile');
    btn.disabled = true;
    appendMsg('bot', 'Extracting profile...');
    try {
      const prof = await extractProfileFromDOM(true);
      if (prof && (prof.name || (prof.skills && prof.skills.length))) {
        await new Promise(r => chrome.storage.local.set({ opti_profile: prof }, r));
        renderProfileSection(prof);
        appendMsg('bot', `Profile saved: ${prof.name || 'Unnamed'} (${(prof.skills||[]).length} skills).`);
        hideEmpty();
      } else {
        appendMsg('bot', 'Could not extract profile. Make sure you are on your LinkedIn profile and the page is loaded.');
      }
    } catch (e) {
      console.error('Extract profile error', e);
      appendMsg('bot', 'Profile extraction failed: ' + (e.message || e));
    } finally { btn.disabled = false }
  });

  // Match job button
  document.getElementById('optiMatchJob').addEventListener('click', async () => {
    const btn = document.getElementById('optiMatchJob');
    btn.disabled = true;
    appendMsg('bot', 'Extracting job description...');
    try {
      const job = await extractJobFromDOM();
      renderJobSection(job);
      if (!job.jobDesc || job.jobDesc.length < 20) {
        appendMsg('bot', 'No job description found. Make sure you opened a job posting (detail view).');
        btn.disabled = false;
        return;
      }

      // Get stored profile
      const stored = await new Promise(r => chrome.storage.local.get(['opti_profile'], r));
      const profile = stored.opti_profile;
      if (!profile) {
        appendMsg('bot', 'No stored profile. Please extract and save your profile first.');
        btn.disabled = false;
        return;
      }

      // Guard: ensure profile includes skills; otherwise matching will inevitably show none
      const skillCount = Array.isArray(profile.skills) ? profile.skills.filter(s => s && String(s).trim().length > 0).length : 0;
      if (skillCount < 3) {
        appendMsg('bot', `Profile has only ${skillCount} skills detected. Open your LinkedIn profile and click "Extract Profile" after expanding "See all skills".`);
        btn.disabled = false;
        return;
      }

      appendMsg('bot', 'Calling match service...');
      const swResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'ANALYZE_JOB_COMPATIBILITY', data: { profile, jobDescription: job.jobDesc, jobTitle: job.jobTitle, company: job.company } },
          (res) => { if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message)); resolve(res) }
        )
      });

      if (!swResponse || !swResponse.success) {
        appendMsg('bot', 'Match service failed: ' + (swResponse && swResponse.error));
        btn.disabled = false;
        return;
      }

      const data = swResponse.data || {};
      renderResultSection(data);
      appendMsg('bot', `Match complete — Score: ${Math.round(data.score||0)}%`);
      if (data.analysis_source === 'local') {
        appendMsg('bot', 'Backend not reachable — used local analysis. Start backend for best accuracy.');
      }
    } catch (err) {
      console.error('Match job error', err);
      appendMsg('bot', 'Match error: ' + (err.message || err));
    } finally { btn.disabled = false }
  });

  // Load stored profile if present
  chrome.storage.local.get(['opti_profile'], (res) => {
    if (res.opti_profile) {
      try { renderProfileSection(res.opti_profile) } catch (e) { console.warn(e) }
      hideEmpty();
    }
  });
}

// Floating toggle button to open the sidebar
function createToggleButton() {
  if (document.getElementById('optiToggleBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'optiToggleBtn';
  btn.title = 'Open OptiHire';
  btn.textContent = '⚡';
  btn.style.position = 'fixed';
  btn.style.right = '18px';
  btn.style.bottom = '18px';
  btn.style.zIndex = 2147483647;
  btn.style.width = '48px';
  btn.style.height = '48px';
  btn.style.borderRadius = '24px';
  btn.style.border = 'none';
  btn.style.background = '#0a66c2';
  btn.style.color = 'white';
  btn.style.fontSize = '20px';
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    const s = document.getElementById('optiSidebar');
    // If sidebar doesn't exist or is hidden, open it; otherwise close it
    if (!s || s.style.display === 'none' || s.style.display === '') openSidebar(); else closeSidebar();
  });
  document.body.appendChild(btn);
}

function openSidebar() {
  createSidebar();
  const s = document.getElementById('optiSidebar');
  if (!s) return;
  s.style.display = 'flex';
  s.style.right = '0';
}

function closeSidebar() {
  const s = document.getElementById('optiSidebar');
  if (!s) return;
  s.style.display = 'none';
}

function toggleMinimize() {
  const s = document.getElementById('optiSidebar');
  if (!s) return;
  const body = document.getElementById('optiBody');
  const footer = document.getElementById('optiFooter');
  if (!body || !footer) return;
  if (body.style.display === 'none') {
    body.style.display = '';
    footer.style.display = '';
    s.style.height = 'calc(100vh - 88px)';
  } else {
    body.style.display = 'none';
    footer.style.display = 'none';
    s.style.height = '48px';
  }
}

function renderProfileSection(profile) {
  createSidebar();
  const sec = document.getElementById('optiProfileSection');
  if (!sec) return;
  const skills = (profile.skills||[]).slice(0,20).map(s=>`<span class="skill-tag">${escapeHtml(s)}</span>`).join('');
  const summary = profile.summary ? `<div class="profile-summary">${escapeHtml(profile.summary)}</div>` : '';
  const experiences = (profile.experiences||[]).slice(0,5).map(e=>`<li>${escapeHtml(e)}</li>`).join('');
  const certs = (profile.certifications||[]).slice(0,5).map(c=>`<li>${escapeHtml(c)}</li>`).join('');
  sec.innerHTML = `<div class="section-header">
      <div>
        <div class="section-title">${escapeHtml(profile.name||'Unnamed')}</div>
        <div class="section-subtitle">${escapeHtml(profile.title||'')}</div>
      </div>
      <div class="section-label">Profile</div>
    </div>
    ${summary}
    <div class="skills-container">${skills||'<em>No skills detected</em>'}</div>
    ${experiences? `<div style="margin-top:8px"><strong>Recent experience:</strong><ul>${experiences}</ul></div>` : ''}
    ${certs? `<div style="margin-top:8px"><strong>Certifications:</strong><ul>${certs}</ul></div>` : ''}`;
}

function renderJobSection(job) {
  createSidebar();
  const sec = document.getElementById('optiJobSection'); 
  if (!sec) return;
  const desc = escapeHtml((job.jobDesc||'').slice(0,800));
  sec.innerHTML = `<div class="section-header">
      <div>
        <div class="section-title">${escapeHtml(job.jobTitle||'Job')}</div>
        <div class="section-subtitle">${escapeHtml(job.company||'')}</div>
      </div>
      <div class="section-label">Job</div>
    </div>
    <div class="job-description">${desc||'<em>No description extracted</em>'}</div>`;
}

function renderResultSection(result) {
  createSidebar();
  const sec = document.getElementById('optiResultSection'); 
  if (!sec) return;
  const score = Math.round(result.score||result.matchScore||0);
  const exact = (result.matched_skills||result.matchedSkills||[]);
  const partial = (result.partial_matches||result.partialMatches||[]);
  const combined = Array.from(new Set([...(exact||[]), ...(partial||[])]));
  const matched = combined.slice(0,20).join(', ') || 'None';
  const missing = (result.missing_skills||result.missingSkills||[]).slice(0,20).join(', ') || 'None';
  const suggestions = (result.suggestions||[]);
  sec.innerHTML = `<div class="section-header">
      <div class="section-title">Match Score: <span class="score-value">${score}%</span></div>
      <div class="section-label">Result</div>
    </div>
    <div class="result-item"><strong>Matched:</strong> ${escapeHtml(matched)}</div>
    <div class="result-item"><strong>Missing:</strong> ${escapeHtml(missing)}</div>
    ${Array.isArray(suggestions) && suggestions.length? 
      `<div class="suggestions"><strong>Suggestions:</strong><ul>${suggestions.slice(0,6).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul></div>` : ''}`;
}

function escapeHtml(s) { 
  return (s||'').toString().replace(/[&<>"']/g, function(c){ 
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] 
  }); 
}

function appendMsg(who, text) {
  createSidebar();
  const messages = document.getElementById('optiMessages');
  if (!messages) return;
  // Ensure messages area is visible
  messages.style.display = 'flex';
  const el = document.createElement('div');
  el.className = `optiMessage ${who==='user' ? 'user' : 'bot'}`;
  el.textContent = text;
  messages.appendChild(el);
  // keep scroll at bottom
  messages.scrollTop = messages.scrollHeight;
  hideEmpty();
}

function hideEmpty() { 
  const e = document.getElementById('optiEmpty'); 
  if (e) e.style.display = 'none'; 
}

/* Consent banner */
function showConsentOnProfile() {
  chrome.storage.local.get(['opti_consent'], (res) => {
    if (res.opti_consent === true) return;
    if (!/\/in\//.test(location.pathname)) return;
    if (document.getElementById('optiConsentBanner')) return;

    const b = document.createElement('div'); 
    b.id = 'optiConsentBanner';
    b.innerHTML = `
      <div class="consent-title">OptiHire — Permission</div>
      <div class="consent-text">Allow OptiHire to read & store your LinkedIn profile locally (used only for matching)?</div>
      <div class="consent-buttons">
        <button id="optiDecline" class="optiSmallBtn">Decline</button>
        <button id="optiAccept" class="optiPrimaryBtn">Accept & Store</button>
      </div>
    `;
    document.body.appendChild(b);

    b.querySelector('#optiDecline').addEventListener('click', () => b.remove());
    b.querySelector('#optiAccept').addEventListener('click', async () => {
      b.querySelector('#optiAccept').disabled = true;
      const prof = await extractProfileFromDOM(true);
      if (!prof || (!prof.name && (!prof.skills || prof.skills.length === 0))) {
        alert('Could not extract profile. Scroll to your Skills section and try again.');
        b.querySelector('#optiAccept').disabled = false;
        return;
      }
      await new Promise(r => chrome.storage.local.set({ opti_profile: prof, opti_consent: true }, r));
      appendMsg('bot', `Profile saved: ${prof.name || 'Unnamed'}. Found ${prof.skills.length} skills.`);
      b.remove();
      createSidebar();
    });
  });
}

/* Inject Match button into job header */
function injectMatchButton() {
  // Disabled: sidebar is the single entry point now.
  return;
}

function showDetailedResult(result, job) {
  createSidebar();
  const normalized = {
    score: result.score ?? result.matchScore ?? 0,
    matched_skills: result.matched_skills ?? result.matchedSkills ?? [],
    missing_skills: result.missing_skills ?? result.missingSkills ?? [],
    suggestions: result.suggestions ?? [],
  }

  window.optiLastResult = { ...normalized, job };

  try {
    renderResultSection(normalized);
    renderJobSection(job);
    chrome.storage.local.get(['opti_profile'], (res) => { 
      if (res.opti_profile) try { renderProfileSection(res.opti_profile) } catch (e){} 
    });
  } catch (e) { console.warn('OptiHire: render sections failed', e) }

  const combined = Array.from(new Set([...(normalized.matched_skills||[]), ...(normalized.partial_matches||[])]));
  const msg = `Job: ${job.jobTitle || 'Job'}\nCompany: ${job.company || ''}\nScore: ${Math.round(normalized.score)}%\nMatched: ${combined.join(', ') || 'None'}\nMissing: ${(normalized.missing_skills||[]).join(', ') || 'None'}`;
  appendMsg('bot', msg);
  
  try {
    const scoreVal = Math.round(normalized.score || 0);
    renderScoreBadge(scoreVal);
  } catch (e) { console.warn('OptiHire: renderScoreBadge failed', e) }
  
  showQuickReplies(['How can I improve?', 'Which skills matched?', 'What are the missing skills?', 'What is the score?'])
}

function renderScoreBadge(score) {
  const prev = document.getElementById('optiScoreBadge');
  if (prev) prev.remove();

  const containers = [
    document.querySelector('.jobs-unified-top-card__content'),
    document.querySelector('.jobs-unified-top-card'),
    document.querySelector('.topcard'),
    document.querySelector('.jobs-details-top-card'),
    document.querySelector('header'),
    document.body
  ];
  let target = null;
  for (const c of containers) { if (c) { target = c; break } }
  if (!target) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'optiScoreBadge';
  wrapper.className = 'opti-score-badge';
  wrapper.innerHTML = `<div class="opti-score-circle ${score>=75? 'high' : score>=50? 'medium' : 'low'}"><span>${score}%</span></div><div class="opti-score-label">Match Score</div>`;
  wrapper.style.position = 'absolute';
  wrapper.style.right = '18px';
  wrapper.style.top = '18px';
  wrapper.style.zIndex = 2147483647;
  try { 
    target.style.position = target.style.position || 'relative'; 
    target.appendChild(wrapper); 
  } catch (e) { 
    document.body.appendChild(wrapper); 
  }
}

async function handleFollowupQuestion(text) {
  const last = window.optiLastResult
  if (!last) {
    appendMsg('bot', 'No match data available. Please click "Match Score" on a job first.')
    return
  }

  const typingEl = showTypingIndicator()

  try {
    const swResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { 
          action: 'ASSISTANT_QUERY',
          data: {
            profile: last.profile || {},
            job: last.job || {},
            lastMatch: last,
            message: text
          }
        },
        (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
          resolve(res)
        }
      )
    })

    if (!swResponse || !swResponse.success) {
      const errMsg = (swResponse && (swResponse.error || swResponse.data?.error)) || 'Assistant error'
      if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl)
      appendMsg('bot', 'Assistant failed: ' + errMsg)
      return
    }

    const data = swResponse.data || {}
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl)

    if (data.reply) {
      await streamResponse(data.reply, typingEl)
      if (Array.isArray(data.quick_replies) && data.quick_replies.length) {
        showQuickReplies(data.quick_replies)
      }
    } else {
      appendMsg('bot', 'Assistant returned no reply')
    }
  } catch (err) {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl)
    console.error('Assistant message error', err)
    appendMsg('bot', 'Assistant error: ' + (err.message || err))
  }
}

function showTypingIndicator() {
  const messages = document.getElementById('optiMessages')
  const el = document.createElement('div')
  el.className = 'optiMessage bot typing'
  el.textContent = 'Typing...'
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
  return el
}

async function streamResponse(fullText, typingEl) {
  const parts = fullText.split(/\n/)
  const parent = typingEl.parentNode
  if (typingEl) parent.removeChild(typingEl)

  for (const p of parts) {
    await new Promise((r) => setTimeout(r, 250))
    appendMsg('bot', p)
  }
}

function showQuickReplies(items) {
  const messages = document.getElementById('optiMessages')
  const container = document.createElement('div')
  container.className = 'optiQuickReplies'
  items.forEach((text) => {
    const btn = document.createElement('button')
    btn.textContent = text
    btn.addEventListener('click', () => {
      appendMsg('user', text)
      handleFollowupQuestion(text)
    })
    container.appendChild(btn)
  })
  messages.appendChild(container)
  messages.scrollTop = messages.scrollHeight
}

/* SPA observer and initial run */
let lastHref = location.href;
const mo = new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    setTimeout(() => {
      showConsentOnProfile();
      createToggleButton();
    }, 700);
  } else {
    // no-op: sidebar toggle is the single entry point
  }
});
mo.observe(document, { childList:true, subtree:true });

showConsentOnProfile();
createToggleButton();

// Handle popup-triggered extraction explicitly
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'EXTRACT_PROFILE') {
    (async () => {
      try {
        const prof = await extractProfileFromDOM(true);
        await new Promise(r => chrome.storage.local.set({ opti_profile: prof }, r));
        appendMsg('bot', `Profile saved: ${prof.name || 'Unnamed'} (${(prof.skills||[]).length} skills).`);
        sendResponse({ success: true });
      } catch (e) {
        appendMsg('bot', (e && e.message) ? e.message : 'Failed to extract profile.');
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true; // keep channel open for async
  }
});

console.log('OptiHire content_script initialized');