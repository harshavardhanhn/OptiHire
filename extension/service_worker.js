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

        case 'OPEN_RESUME_PAGE':
          try {
            // allow caller to specify a URL (e.g., local dev server). Otherwise open bundled page.
            const url = request.url || chrome.runtime.getURL('resume/resume.html');
            chrome.tabs.create({ url }, (tab) => {
              sendResponse({ success: true, tabId: tab && tab.id });
            });
          } catch (err) {
            console.error('Background: OPEN_RESUME_PAGE failed', err);
            sendResponse({ success: false, error: err.message });
          }
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
      const backendResult = await this.callBackendAPI('/api/match', {
        profile: this.prepareProfileForBackend(profile),
        job_text: jobDescription
      });

      return backendResult;
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
    return {
      name: profile.name,
      headline: profile.headline,
      about: profile.about,
      skills: profile.skills || [],
      experience: profile.experience || [],
      education: profile.education || [],
      location: profile.location
    };
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
    const profileSkills = profile.skills || [];
    const jobText = jobDescription.toLowerCase();
    
    const commonSkills = [
      'javascript', 'python', 'java', 'react', 'node.js', 'aws', 'sql', 'mongodb',
      'docker', 'kubernetes', 'machine learning', 'ai', 'typescript', 'angular',
      'vue', 'php', 'c#', 'c++', 'ruby', 'go', 'rust', 'swift', 'kotlin',
      'html', 'css', 'express', 'django', 'flask', 'mysql', 'postgresql', 'redis'
    ];
    
    const matchedSkills = commonSkills.filter(skill => 
      jobText.includes(skill) && profileSkills.some(profileSkill => 
        profileSkill.toLowerCase().includes(skill) || skill.includes(profileSkill.toLowerCase())
      )
    );
    
    const missingSkills = commonSkills.filter(skill => 
      jobText.includes(skill) && !profileSkills.some(profileSkill => 
        profileSkill.toLowerCase().includes(skill) || skill.includes(profileSkill.toLowerCase())
      )
    );
    
    const score = Math.min(Math.round((matchedSkills.length / Math.max(commonSkills.filter(s => jobText.includes(s)).length, 1)) * 100), 100);
    
    return {
      score: score,
      matched_skills: matchedSkills,
      missing_skills: missingSkills,
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