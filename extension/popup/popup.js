document.addEventListener('DOMContentLoaded', async () => {
    await loadPopupData();
    await checkBackendHealth();
    
    document.getElementById('open-linkedin').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://www.linkedin.com' });
    });
    
    document.getElementById('refresh-profile').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab.url.includes('linkedin.com')) {
            chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_PROFILE' });
            window.close();
        } else {
            chrome.tabs.create({ url: 'https://www.linkedin.com' });
        }
    });
    
    document.getElementById('check-backend').addEventListener('click', async () => {
        await checkBackendHealth();
    });

        // Resume builder button - open resume.html inside extension
    const resumeBtn = document.getElementById('resumeBuilderBtn');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            const localUrl = 'http://127.0.0.1:5500/extension/resume/resume.html';
            chrome.tabs.create({ url: localUrl });
            window.close();
        });
    }

});

async function loadPopupData() {
    try {
        const result = await chrome.storage.local.get(['opti_profile', 'lastUpdated']);
        
        if (result.opti_profile) {
            document.getElementById('profile-status').textContent = 'Loaded';
            document.getElementById('profile-status').style.color = '#0a66c2';
            
            if (result.lastUpdated) {
                const date = new Date(result.lastUpdated);
                document.getElementById('last-updated').textContent = date.toLocaleDateString();
            }
        } else {
            document.getElementById('profile-status').textContent = 'Not Loaded';
            document.getElementById('profile-status').style.color = '#d32f2f';
        }
    } catch (error) {
        console.error('Error loading popup data:', error);
        document.getElementById('profile-status').textContent = 'Error';
    }
}

async function checkBackendHealth() {
    const backendStatus = document.getElementById('backend-status');
    const checkBtn = document.getElementById('check-backend');
    
    backendStatus.textContent = 'Checking...';
    backendStatus.style.color = '#ff9800';
    checkBtn.disabled = true;
    
    try {
        const response = await chrome.runtime.sendMessage({ 
            action: 'CHECK_BACKEND_HEALTH' 
        });
        
        if (response.success && response.data.healthy) {
            backendStatus.textContent = 'Healthy';
            backendStatus.style.color = '#4caf50';
        } else {
            backendStatus.textContent = response.data?.message || 'Unhealthy';
            backendStatus.style.color = '#f44336';
        }
    } catch (error) {
        console.error('Error checking backend health:', error);
        backendStatus.textContent = 'Connection Failed';
        backendStatus.style.color = '#f44336';
    } finally {
        checkBtn.disabled = false;
    }
}