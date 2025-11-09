from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler
import spacy
import re
import json
from typing import Dict, List, Tuple

app = Flask(__name__)
CORS(app)

class JobCompatibilityAnalyzer:
    def __init__(self):
        # Load spaCy model for advanced NLP
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except OSError:
            # Fallback to basic tokenization if spaCy not available
            self.nlp = None
        
        # Initialize TF-IDF vectorizer
        self.vectorizer = TfidfVectorizer(
            max_features=1000,
            stop_words='english',
            ngram_range=(1, 2)
        )
        
        # Common skills database
        self.skills_db = {
            'programming': ['python', 'javascript', 'java', 'c++', 'c#', 'ruby', 'go', 'rust', 'swift', 'kotlin'],
            'web': ['html', 'css', 'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask'],
            'databases': ['sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'oracle'],
            'cloud': ['aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform'],
            'data_science': ['pandas', 'numpy', 'scikit-learn', 'tensorflow', 'pytorch', 'machine learning'],
            'devops': ['jenkins', 'git', 'ci/cd', 'ansible', 'prometheus', 'grafana']
        }
    
    def extract_skills_from_text(self, text: str) -> List[str]:
        """Extract skills from text using multiple methods"""
        skills_found = []
        text_lower = text.lower()
        
        # Method 1: Direct keyword matching
        for category, skills in self.skills_db.items():
            for skill in skills:
                if skill in text_lower:
                    skills_found.append(skill)
        
        # Method 2: Pattern matching for experience levels
        experience_patterns = {
            r'(\d+)\+?\s*years?.*?(python|java|javascript)': 'expert',
            r'(proficient|experienced).*?(python|java|javascript)': 'experienced',
            r'(familiar|basic).*?(python|java|javascript)': 'beginner'
        }
        
        # Method 3: Use spaCy for entity recognition if available
        if self.nlp:
            doc = self.nlp(text)
            for ent in doc.ents:
                if ent.label_ in ["ORG", "PRODUCT"]:
                    # Check if it's a known technology
                    ent_text = ent.text.lower()
                    for skills in self.skills_db.values():
                        if any(skill in ent_text for skill in skills):
                            skills_found.append(ent_text)
        
        return list(set(skills_found))
    
    def calculate_semantic_similarity(self, profile_text: str, job_description: str) -> float:
        """Calculate semantic similarity using TF-IDF and cosine similarity"""
        try:
            # Combine texts for vectorization
            texts = [profile_text, job_description]
            tfidf_matrix = self.vectorizer.fit_transform(texts)
            
            # Calculate cosine similarity
            similarity = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])
            return float(similarity[0][0]) * 100
        except Exception as e:
            print(f"Error in semantic similarity: {e}")
            return 0.0
    
    def analyze_experience_level(self, profile_experience: List[Dict], job_requirements: str) -> Dict:
        """Analyze experience level compatibility"""
        total_years = sum(exp.get('years', 0) for exp in profile_experience)
        
        # Extract required years from job description
        year_patterns = [
            r'(\d+)\+?\s*years?',
            r'(\d+)\s*-\s*(\d+)\s*years?',
            r'at least\s*(\d+)\s*years?'
        ]
        
        required_years = 0
        for pattern in year_patterns:
            matches = re.findall(pattern, job_requirements.lower())
            if matches:
                if isinstance(matches[0], tuple):
                    # Range like "3-5 years"
                    required_years = max([int(x) for x in matches[0]])
                else:
                    required_years = max([int(match) for match in matches])
                break
        
        if required_years == 0:
            experience_score = 100  # No specific requirement
        else:
            experience_score = min((total_years / required_years) * 100, 100)
        
        return {
            'score': round(experience_score),
            'your_experience': total_years,
            'required_experience': required_years,
            'sufficient': total_years >= required_years
        }
    
    def analyze_skills_compatibility(self, profile_skills: List[str], job_description: str) -> Dict:
        """Analyze skills compatibility with advanced matching"""
        job_skills = self.extract_skills_from_text(job_description)
        profile_skills_lower = [skill.lower() for skill in profile_skills]
        
        # Exact matches
        exact_matches = [skill for skill in job_skills if skill in profile_skills_lower]
        
        # Partial matches (substring matches)
        partial_matches = []
        for job_skill in job_skills:
            if job_skill not in exact_matches:
                for profile_skill in profile_skills_lower:
                    if job_skill in profile_skill or profile_skill in job_skill:
                        partial_matches.append(job_skill)
                        break
        
        all_matches = exact_matches + partial_matches
        missing_skills = [skill for skill in job_skills if skill not in all_matches]
        
        # Calculate score (exact matches weighted higher)
        exact_score = (len(exact_matches) / len(job_skills)) * 70 if job_skills else 0
        partial_score = (len(partial_matches) / len(job_skills)) * 30 if job_skills else 0
        total_score = min(exact_score + partial_score, 100)
        
        return {
            'score': round(total_score),
            'exact_matches': exact_matches,
            'partial_matches': partial_matches,
            'missing_skills': missing_skills,
            'total_required': len(job_skills),
            'matched_count': len(all_matches)
        }
    
    def generate_improvement_suggestions(self, analysis: Dict) -> List[str]:
        """Generate intelligent improvement suggestions"""
        suggestions = []
        
        # Skills suggestions
        if analysis['skills']['score'] < 80:
            missing_count = len(analysis['skills']['missing_skills'])
            if missing_count > 0:
                top_missing = analysis['skills']['missing_skills'][:3]
                suggestions.append(f"Learn these key skills: {', '.join(top_missing)}")
        
        # Experience suggestions
        if analysis['experience']['score'] < 100:
            exp_gap = analysis['experience']['required_experience'] - analysis['experience']['your_experience']
            if exp_gap > 0:
                suggestions.append(f"Gain {exp_gap} more years of relevant experience")
            else:
                suggestions.append("Highlight your experience more prominently in your profile")
        
        # General suggestions
        suggestions.extend([
            "Add specific project examples that demonstrate required skills",
            "Include quantifiable achievements in your experience section",
            "Use industry-specific keywords from the job description",
            "Obtain relevant certifications for missing technical skills"
        ])
        
        return suggestions[:5]  # Return top 5 suggestions
    
    def analyze_compatibility(self, profile_data: Dict, job_data: Dict) -> Dict:
        """Main analysis function"""
        try:
            # Prepare profile text for semantic analysis
            profile_text = " ".join([
                profile_data.get('headline', ''),
                profile_data.get('about', ''),
                " ".join([exp.get('title', '') + " " + exp.get('description', '') 
                         for exp in profile_data.get('experience', [])]),
                " ".join(profile_data.get('skills', []))
            ])
            
            job_description = job_data.get('description', '')
            
            # Perform various analyses
            semantic_score = self.calculate_semantic_similarity(profile_text, job_description)
            skills_analysis = self.analyze_skills_compatibility(
                profile_data.get('skills', []), 
                job_description
            )
            experience_analysis = self.analyze_experience_level(
                profile_data.get('experience', []), 
                job_description
            )
            
            # Calculate weighted overall score
            overall_score = (
                semantic_score * 0.3 +
                skills_analysis['score'] * 0.5 +
                experience_analysis['score'] * 0.2
            )
            
            # Generate suggestions
            suggestions = self.generate_improvement_suggestions({
                'skills': skills_analysis,
                'experience': experience_analysis
            })
            
            return {
                'overall_score': round(overall_score),
                'breakdown': {
                    'semantic_similarity': round(semantic_score),
                    'skills': skills_analysis,
                    'experience': experience_analysis
                },
                'matched_skills': skills_analysis['exact_matches'],
                'partial_matches': skills_analysis['partial_matches'],
                'missing_skills': skills_analysis['missing_skills'],
                'suggestions': suggestions,
                'top_matches': self.find_top_matches(profile_data, job_data),
                'compatibility_insights': self.generate_insights(
                    skills_analysis, experience_analysis, semantic_score
                )
            }
            
        except Exception as e:
            print(f"Error in compatibility analysis: {e}")
            return self.get_fallback_analysis(profile_data, job_data)
    
    def find_top_matches(self, profile_data: Dict, job_data: Dict) -> List[Dict]:
        """Find the strongest alignment points"""
        profile_skills = profile_data.get('skills', [])
        job_desc = job_data.get('description', '').lower()
        
        top_matches = []
        for skill in profile_skills[:5]:  # Top 5 skills
            if skill.lower() in job_desc:
                top_matches.append({
                    'skill': skill,
                    'strength': 'Strong match',
                    'reason': 'Directly mentioned in job requirements'
                })
        
        return top_matches
    
    def generate_insights(self, skills_analysis: Dict, experience_analysis: Dict, semantic_score: float) -> List[str]:
        """Generate intelligent insights about the match"""
        insights = []
        
        if skills_analysis['score'] >= 80:
            insights.append("Your skills strongly align with the job requirements")
        elif skills_analysis['score'] >= 60:
            insights.append("You have a good foundation of required skills")
        else:
            insights.append("Consider developing more of the required skills")
        
        if experience_analysis['sufficient']:
            insights.append("Your experience level meets or exceeds requirements")
        else:
            insights.append("Your experience level is below the required amount")
        
        if semantic_score >= 70:
            insights.append("Your profile language closely matches the job description")
        
        return insights
    
    def get_fallback_analysis(self, profile_data: Dict, job_data: Dict) -> Dict:
        """Provide fallback analysis if main analysis fails"""
        return {
            'overall_score': 50,
            'breakdown': {
                'semantic_similarity': 50,
                'skills': {'score': 50, 'missing_skills': [], 'exact_matches': []},
                'experience': {'score': 50, 'your_experience': 0, 'required_experience': 0}
            },
            'matched_skills': [],
            'missing_skills': [],
            'suggestions': ['Ensure your profile is complete with skills and experience'],
            'top_matches': [],
            'compatibility_insights': ['Basic analysis completed']
        }

# Global analyzer instance
analyzer = JobCompatibilityAnalyzer()

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'message': 'OptiHire backend is running'})

@app.route('/analyze', methods=['POST'])
def analyze_compatibility():
    try:
        data = request.json
        profile_data = data.get('profile', {})
        job_data = data.get('job', {})
        
        if not profile_data or not job_data:
            return jsonify({'error': 'Profile and job data required'}), 400
        
        analysis = analyzer.analyze_compatibility(profile_data, job_data)
        
        return jsonify({
            'success': True,
            'analysis': analysis,
            'timestamp': pd.Timestamp.now().isoformat()
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/extract-skills', methods=['POST'])
def extract_skills():
    try:
        data = request.json
        text = data.get('text', '')
        
        skills = analyzer.extract_skills_from_text(text)
        
        return jsonify({
            'success': True,
            'skills': skills,
            'count': len(skills)
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)