const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// Mount API router which forwards to the ML service (with caching) and provides assistant endpoints
const matchRoutes = require('./routes/matchRoutes');
app.use('/api', matchRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'OptiHire Backend API',
        version: '1.0.0'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'OptiHire Backend Server is running!',
        endpoints: {
            'POST /api/match': 'Analyze job compatibility',
            'POST /api/assistant': 'Get career advice and insights',
            'GET /api/health': 'Health check'
        },
        version: '1.0.0'
    });
});

app.listen(PORT, () => {
    console.log(`🎯 OptiHire backend server running on http://localhost:${PORT}`);
    console.log('📡 Endpoints:');
    console.log(`   POST /api/match - Analyze job compatibility`);
    console.log(`   POST /api/assistant - Career advice and insights`);
    console.log(`   GET  /api/health - Health check`);
    console.log(`   GET  / - Server info`);
});