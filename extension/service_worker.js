class OptiHireBackground {
  constructor() {
    this.backendUrl = 'http://localhost:4000';
    this.init();
  }

  init() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      const action = request.action || request.type;
      
      switch (action) {
        case 'MATCH_JOB':
        case 'ANALYZE_JOB_COMPATIBILITY':
          const analysis = await this.analyzeWithBackend(request.data || {
            profile: request.profile,
            jobDescription: request.jobText,
            jobTitle: request.jobTitle,
            company: request.company
          });
          sendResponse({ success: true, data: analysis });
          break;
        
        case 'ASSISTANT':
        case 'ASSISTANT_QUERY':
          const assistantResponse = await this.handleAssistantQuery(request.data || {
            profile: request.profile,
            job: request.job,
            lastMatch: request.lastMatch,
            message: request.message
          });
          sendResponse({ success: true, data: assistantResponse });
          break;
        
        case 'SAVE_PROFILE_DATA':
          await this.saveProfileData(request.data);
          sendResponse({ success: true });
          break;
        
        case 'GET_PROFILE_DATA':
          const profile = await this.getProfileData();
          sendResponse({ success: true, data: profile });
          break;
        
        case 'CHECK_BACKEND_HEALTH':
          const health = await this.checkBackendHealth();
          sendResponse({ success: true, data: health });
          break;
        
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async analyzeWithBackend({ profile, jobDescription, jobTitle, company }) {
    try {
      const prepared = this.prepareProfileForBackend(profile);
      const backendResult = await this.callBackendAPI('/api/match', {
        profile: prepared,
        job_text: jobDescription
      });

      // If backend returned no matched skills, enrich using local detection
      const backendMatched = (backendResult?.matched_skills?.length || 0) + (backendResult?.partial_matches?.length || 0);
      if (backendMatched === 0) {
        const local = await this.localCompatibilityAnalysis(profile, jobDescription, jobTitle, company);
        const total = Math.max(local.total_skills || 0, 1);
        const skillsScore = Math.round(((local.matched_skills.length + local.partial_matches.length) / total) * 100);
        return {
          ...backendResult,
          matched_skills: local.matched_skills,
          partial_matches: local.partial_matches,
          missing_skills: local.missing_skills,
          matched_count: local.matched_count,
          total_skills: local.total_skills,
          score: skillsScore,
          analysis_source: 'backend+local'
        };
      }

      // Ensure skills-only score consistency when backend provides totals
      const total = backendResult?.total_skills ?? ((backendResult?.matched_skills?.length || 0) + (backendResult?.missing_skills?.length || 0));
      const skillsScore = total > 0 ? Math.round(((backendResult?.matched_skills?.length || 0) / total) * 100) : (backendResult?.score || 0);
      return { ...backendResult, score: skillsScore, analysis_source: 'backend' };
    } catch (error) {
      console.error('Backend analysis error:', error);
      return await this.localCompatibilityAnalysis(profile, jobDescription, jobTitle, company);
    }
  }

  async handleAssistantQuery({ profile, job, lastMatch, message }) {
    try {
      const response = await this.callBackendAPI('/api/assistant', {
        profile: this.prepareProfileForBackend(profile),
        job: job,
        last_match: lastMatch,
        message: message
      });

      return response;
    } catch (error) {
      console.error('Assistant error:', error);
      return this.generateFallbackAssistantResponse(message, lastMatch);
    }
  }

  async callBackendAPI(endpoint, data) {
    const response = await fetch(`${this.backendUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Backend API error: ${response.status}`);
    }

    return await response.json();
  }

  prepareProfileForBackend(profile) {
    try {
      if (!profile || typeof profile !== 'object') {
        return { name: '', headline: '', about: '', skills: [], experience: [], education: [], location: '' };
      }

      const headline = profile.title || profile.headline || '';
      const about = profile.summary || profile.about || '';
      const skills = Array.isArray(profile.skills) ? profile.skills : [];
      // Canonicalize common synonyms so server-side matching is consistent
      const syn = new Map([
        ['c++','c++'], ['cpp','c++'], ['c#','c#'], ['csharp','c#'], ['node.js','node.js'], ['nodejs','node.js'],
        ['react.js','react'], ['reactjs','react'], ['express.js','express'], ['expressjs','express'],
        ['google cloud','gcp'], ['gcp','gcp'], ['machine learning','machine learning'], ['ml','machine learning'],
        ['natural language processing','nlp'], ['nlp','nlp'], ['js','javascript'], ['ecmascript','javascript'], ['es6','javascript'],
        ['css3','css'], ['html5','html']
      ]);
      const canonSkills = skills.map(s => {
        const t = (s||'').toLowerCase().replace(/\([^)]*\)/g, '').trim();
        // Prefer canonical synonym, else use normalized lowercase token
        // Also collapse common variants
        const mapped = syn.get(t);
        return mapped ? mapped : t;
      }).filter(Boolean);

      const expRaw = Array.isArray(profile.experiences)
        ? profile.experiences
        : (Array.isArray(profile.experience) ? profile.experience : []);

      const experience = expRaw.map((e) => {
        if (typeof e === 'string') return { title: e, description: '' };
        if (e && typeof e === 'object') {
          return {
            title: e.title || e.role || '',
            description: e.description || e.summary || '',
            years: e.years || e.duration || 0
          };
        }
        return { title: String(e || ''), description: '' };
      });

      const education = Array.isArray(profile.education) ? profile.education : [];
      const location = profile.location || '';

      return {
        name: profile.name || '',
        headline,
        about,
        skills: canonSkills,
        experience,
        education,
        location
      };
    } catch (e) {
      console.warn('prepareProfileForBackend failed, using minimal profile', e);
      return { name: profile?.name || '', headline: profile?.title || '', about: profile?.summary || '', skills: profile?.skills || [], experience: [], education: [], location: '' };
    }
  }

  async checkBackendHealth() {
    try {
      const response = await fetch(`${this.backendUrl}/api/health`);
      const data = await response.json();
      return {
        healthy: response.ok,
        message: data.message || data.status
      };
    } catch (error) {
      return {
        healthy: false,
        message: 'Backend not reachable'
      };
    }
  }

  async localCompatibilityAnalysis(profile, jobDescription, jobTitle, company) {
    const norm = (s) => (s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '');
    const synonyms = new Map([
      ['c++','cpp'], ['c#','csharp'], ['node.js','nodejs'], ['react.js','reactjs'], ['express.js','expressjs'],
      ['google cloud','gcp'], ['machine learning','machinelearning'], ['natural language processing','nlp'],
      ['js','javascript'], ['cascading style sheets','css'], ['css3','css'], ['html5','html'], ['ecmascript','javascript'], ['es6','javascript'], ['github','git']
    ]);
    const normalize = (s) => synonyms.get((s||'').toLowerCase()) || (s||'').toLowerCase();

    // Normalize profile skills and keep a set for matching
    const profileSkillsNorm = new Set((profile?.skills || []).map(s => norm(normalize(s))).filter(Boolean));
    const jobTextRaw = jobDescription || '';
    const jobText = jobTextRaw.toLowerCase();

    // Canonical skill list similar to ML service
    const skillsDb = [
      'python','javascript','js','java','c++','cpp','c#','csharp','ruby','go','golang','rust','swift','kotlin',
      'html','html5','css','css3','react','react.js','reactjs','angular','vue','node.js','nodejs','express','express.js','expressjs','django','flask','next.js','nextjs','graphql',
      'sql','mysql','postgresql','postgres','mongodb','redis','oracle',
      'aws','azure','gcp','google cloud','docker','kubernetes','terraform',
      'pandas','numpy','scikit-learn','sklearn','tensorflow','pytorch','machine learning','ml','natural language processing','nlp',
      'jenkins','git','ci/cd','ansible','prometheus','grafana'
    ];

    // Extract job skills using regex on both raw and normalized forms
    const present = [];
    const seen = new Set();
    const jobNorm = norm(jobTextRaw);
    for (const canon of skillsDb) {
      if (seen.has(canon)) continue;
      const re = new RegExp(`(^|[^a-z0-9])${canon.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      const canonNorm = norm(normalize(canon));
      if (re.test(jobText) || (canonNorm && jobNorm.includes(canonNorm))) {
        present.push(canon);
        seen.add(canon);
      }
      if (present.length >= 10) break; // cap to avoid dilution
    }

    // Compute exact and partial matches
    const exactMatches = [];
    const partialMatches = [];
    const presentNorm = present.map(s => norm(normalize(s)));
    for (let i = 0; i < present.length; i++) {
      const canon = present[i];
      const n = presentNorm[i];
      if (!n) continue;
      if (profileSkillsNorm.has(n)) {
        exactMatches.push(canon);
      } else {
        // partial: substring containment on normalized forms
        const hasPartial = Array.from(profileSkillsNorm).some(p => p.includes(n) || n.includes(p));
        if (hasPartial) partialMatches.push(canon);
      }
    }

    const allMatchesSet = new Set([...exactMatches, ...partialMatches]);
    const missingSkills = present.filter(canon => !allMatchesSet.has(canon));

    const denom = Math.max(present.length, 1);
    const score = Math.round(((exactMatches.length + partialMatches.length) / denom) * 100);

    return {
      score,
      matched_skills: exactMatches,
      partial_matches: partialMatches,
      missing_skills: missingSkills,
      matched_count: allMatchesSet.size,
      total_skills: present.length,
      suggestions: [
        'Add missing technical skills to your profile',
        'Highlight relevant experience in your summary',
        'Include specific projects that demonstrate required skills',
        'Consider obtaining certifications for missing technologies'
      ],
      analysis_source: 'local'
    };
  }

  generateFallbackAssistantResponse(message, lastMatch) {
    const messageLower = message.toLowerCase();
    let reply = '';
    
    if (messageLower.includes('improve') || messageLower.includes('better')) {
      reply = `Based on your ${lastMatch?.score || 0}% match score, focus on developing these skills: ${(lastMatch?.missing_skills || []).slice(0, 5).join(', ')}. Also consider gaining experience in related technologies and highlighting transferable skills in your profile.`;
    } else if (messageLower.includes('skill') && messageLower.includes('match')) {
      reply = `Your profile matches these skills: ${(lastMatch?.matched_skills || []).join(', ') || 'None'}. These are directly mentioned in the job description and present in your profile.`;
    } else if (messageLower.includes('missing')) {
      reply = `The job requires these skills that are missing from your profile: ${(lastMatch?.missing_skills || []).join(', ') || 'None'}. Consider learning these to improve your match.`;
    } else if (messageLower.includes('score')) {
      reply = `Your current match score is ${lastMatch?.score || 0}%. This is calculated based on skill alignment between your profile and the job requirements.`;
    } else {
      reply = `I can help you understand your ${lastMatch?.score || 0}% match score. Ask me about matched skills, missing skills, or how to improve your compatibility.`;
    }
    
    return {
      reply: reply,
      quick_replies: ['How can I improve?', 'Which skills matched?', 'What are the missing skills?', 'What is the score?']
    };
  }

  async saveProfileData(profileData) {
    await chrome.storage.local.set({ 
      linkedinProfile: profileData,
      lastUpdated: new Date().toISOString()
    });
  }

  async getProfileData() {
    const result = await chrome.storage.local.get(['linkedinProfile']);
    return result.linkedinProfile || null;
  }
}

new OptiHireBackground();