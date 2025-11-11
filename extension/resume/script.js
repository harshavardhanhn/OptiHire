// Apply Tailwind-like styles to inputs
document.querySelectorAll('textarea, input:not([type="submit"]):not([type="button"])').forEach(el => {
  el.classList.add(
    'w-full', 'p-3', 'border', 'border-gray-300',
    'rounded-lg', 'focus:ring-blue-500', 'focus:border-blue-500',
    'transition', 'duration-150'
  );
});

const inputSmallClass = "w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500";

function addEducationEntry() {
  const container = document.getElementById('education-container');
  const entry = document.createElement('div');
  entry.className = 'education-entry mb-4 p-4 border rounded-lg bg-gray-50 relative';
  entry.innerHTML = `
    <input type="text" placeholder="Degree/Board" class="${inputSmallClass} mb-2" required>
    <input type="text" placeholder="Institution" class="${inputSmallClass} mb-2" required>
    <div class="grid grid-cols-2 gap-2 mt-2">
      <input type="text" placeholder="Year Range" class="${inputSmallClass}" required>
      <input type="text" placeholder="Grade/Percentage" class="${inputSmallClass}" required>
    </div>
    <button type="button" onclick="removeEntry(this)" class="absolute top-2 right-2 text-red-500 hover:text-red-700 text-lg font-bold">&times;</button>
  `;
  container.appendChild(entry);
}

function addProjectEntry() {
  const container = document.getElementById('projects-container');
  const entry = document.createElement('div');
  entry.className = 'project-entry mb-4 p-4 border rounded-lg bg-gray-50 relative';
  entry.innerHTML = `
    <input type="text" placeholder="Project Name" class="${inputSmallClass} font-medium" required>
    <input type="text" placeholder="Tech Stack" class="${inputSmallClass} text-sm mt-2" required>
    <textarea placeholder="Detailed description (one bullet per line)" rows="4" class="${inputSmallClass} resize-y mt-2" required></textarea>
    <button type="button" onclick="removeEntry(this)" class="absolute top-2 right-2 text-red-500 hover:text-red-700 text-lg font-bold">&times;</button>
  `;
  container.appendChild(entry);
}

function removeEntry(button) {
  button.closest('.education-entry, .project-entry').remove();
}

// jsPDF import
const { jsPDF } = window.jspdf;

function collectFormData() {
  const getVal = (id) => document.getElementById(id)?.value.trim() || '';
  const data = {
    name: getVal('name'),
    email: getVal('email'),
    mobile: getVal('mobile'),
    linkedin: getVal('linkedin'),
    github: getVal('github'),
    skills: getVal('skills'),
    certifications: getVal('certifications'),
    hobbies: getVal('hobbies'),
    education: [],
    projects: []
  };

  document.querySelectorAll('#education-container .education-entry').forEach(entry => {
    const inputs = entry.querySelectorAll('input[type="text"]');
    if (inputs.length === 4) {
      data.education.push({
        degree: inputs[0].value.trim(),
        institution: inputs[1].value.trim(),
        years: inputs[2].value.trim(),
        grade: inputs[3].value.trim(),
      });
    }
  });

  document.querySelectorAll('#projects-container .project-entry').forEach(entry => {
    const inputs = entry.querySelectorAll('input[type="text"]');
    const name = inputs[0].value.trim();
    const techStack = inputs[1].value.trim();
    const description = entry.querySelector('textarea').value.trim();
    if (name && description) data.projects.push({ name, techStack, description });
  });

  return data;
}

function generatePDF() {
  document.getElementById('loading-message').classList.remove('hidden');
  const data = collectFormData();
  const doc = new jsPDF('p', 'mm', 'a4');
  let y = 15;
  const x = 20;
  const maxLineWidth = 170;

  const addText = (text, size, style, xPos, lineHeight = 1.2) => {
    doc.setFont('Times-Roman', style);
    doc.setFontSize(size);
    const splitText = doc.splitTextToSize(text, maxLineWidth);
    doc.text(splitText, xPos, y);
    y += splitText.length * size * 0.35 * lineHeight;
  };

  const drawSectionHeader = (title) => {
    y += 5;
    addText(title.toUpperCase(), 11, 'bold', x);
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.4);
    doc.line(x, y, x + maxLineWidth, y);
    y += 4;
  };

  // HEADER
  doc.setFont('Times-Roman', 'bold');
  doc.setFontSize(22);
  doc.text(data.name.toUpperCase() || "YOUR NAME", x, y);
  y += 10;

  doc.setFont('Times-Roman', 'normal');
  doc.setFontSize(9);

  let currentX = x;
  let currentY = y;
  if (data.mobile) doc.text(`Mobile: ${data.mobile}`, currentX, currentY += 4);
  if (data.email) doc.text(`Email: ${data.email}`, currentX, currentY += 4);

  currentX = x + maxLineWidth / 2;
  currentY = y;
  if (data.linkedin) doc.text(`LinkedIn: ${data.linkedin}`, currentX, currentY += 4);
  if (data.github) doc.text(`GitHub: ${data.github}`, currentX, currentY += 4);

  y = Math.max(y + 2, currentY + 3);

  // EDUCATION
  if (data.education.length) {
    drawSectionHeader('Education');
    data.education.forEach(edu => {
      doc.setFont('Times-Roman', 'bold');
      doc.setFontSize(10);
      doc.text(edu.institution, x, y);
      doc.text(edu.years, x + maxLineWidth, y, { align: 'right' });
      y += 4;

      doc.setFont('Times-Roman', 'italic');
      doc.setFontSize(9);
      doc.text(`${edu.degree} | ${edu.grade}`, x, y);
      y += 6;
    });
  }

  // SKILLS
  if (data.skills) {
    drawSectionHeader('Skills Summary');
    addText(data.skills.replace(/\n/g, ' '), 9, 'normal', x);
    y += 2;
  }

  // PROJECTS
  if (data.projects.length) {
    drawSectionHeader('Projects');
    data.projects.forEach(proj => {
      doc.setFont('Times-Roman', 'bold');
      doc.setFontSize(10);
      doc.text(proj.name, x, y);
      doc.setFont('Times-Roman', 'normal');
      doc.text(`(${proj.techStack})`, x + maxLineWidth, y, { align: 'right' });
      y += 4;

      const lines = proj.description.split('\n').filter(l => l.trim());
      doc.setFontSize(9);
      lines.forEach(line => {
        if (y > 280) { doc.addPage(); y = 15; }
        addText('• ' + line.trim(), 9, 'normal', x);
      });
      y += 3;
    });
  }

  // CERTIFICATIONS
  if (data.certifications) {
    drawSectionHeader('Certifications');
    data.certifications.split('\n').filter(l => l.trim()).forEach(line => {
      if (y > 280) { doc.addPage(); y = 15; }
      addText(line.trim(), 9, 'normal', x);
    });
    y += 2;
  }

  // HOBBIES
  if (data.hobbies) {
    drawSectionHeader('Hobbies & Interest');
    addText(data.hobbies.replace(/\n/g, ' '), 9, 'normal', x);
  }

  // Save PDF
  doc.save(`${data.name.replace(/\s/g, '_') || 'Resume'}.pdf`);
  document.getElementById('loading-message').classList.add('hidden');
}
;