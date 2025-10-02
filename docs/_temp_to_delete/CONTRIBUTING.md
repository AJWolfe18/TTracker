# Contributing to TrumpyTracker

Thank you for your interest in contributing to TrumpyTracker! This project aims to promote government transparency and accountability through open-source collaboration.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and harassment-free experience for everyone, regardless of:
- Political affiliation or beliefs
- Level of experience
- Gender identity and expression
- Sexual orientation
- Disability
- Personal appearance
- Body size
- Race, ethnicity, or religion
- Technology choices

### Expected Behavior

- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what's best for the project
- Show empathy towards other contributors
- Maintain political neutrality in code and documentation
- Respect the project's accountability mission

### Unacceptable Behavior

- Harassment or discriminatory language
- Personal or political attacks
- Publishing others' private information
- Conduct inappropriate for a professional setting
- Attempting to bias the tracking system
- Removing or censoring legitimate accountability data

## How to Contribute

### Ways to Contribute

1. **Code Contributions**
   - Fix bugs
   - Add features
   - Improve performance
   - Enhance UI/UX

2. **Documentation**
   - Improve existing docs
   - Add examples
   - Translate documentation
   - Create tutorials

3. **Testing**
   - Report bugs
   - Test new features
   - Verify fixes
   - Performance testing

4. **Design**
   - UI improvements
   - Mobile responsiveness
   - Accessibility enhancements
   - Data visualizations

5. **Data Quality**
   - Report inaccurate entries
   - Suggest source improvements
   - Verify unverified entries
   - Identify duplicates

## Development Setup

### Prerequisites

```bash
# Required software
Node.js 16+
Git
npm or yarn
```

### Local Setup

1. **Fork the repository**
```bash
# Click "Fork" on GitHub
```

2. **Clone your fork**
```bash
git clone https://github.com/YOUR_USERNAME/TTracker.git
cd TTracker
```

3. **Add upstream remote**
```bash
git remote add upstream https://github.com/AJWolfe18/TTracker.git
```

4. **Install dependencies**
```bash
npm install
```

5. **Set up environment variables**
```bash
# Create .env file
cp .env.example .env
# Add your API keys
```

6. **Start local server**
```bash
npm run server
# Visit http://localhost:8080
```

## Development Workflow

### Branch Strategy

```bash
main          # Production branch
├── test      # Test environment
└── feature/* # Feature branches
```

### Creating a Feature

1. **Update your fork**
```bash
git checkout test
git pull upstream test
```

2. **Create feature branch**
```bash
git checkout -b feature/your-feature-name
```

3. **Make changes**
```bash
# Edit files
git add .
git commit -m "Type: Description"
```

4. **Test thoroughly**
```bash
# Run local tests
npm test
# Test in browser
```

5. **Push to your fork**
```bash
git push origin feature/your-feature-name
```

6. **Create Pull Request**
- Target: `test` branch
- Include description
- Reference any issues

### Commit Messages

Use conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

**Examples:**
```bash
feat(dashboard): add date range filter
fix(api): handle rate limiting correctly
docs(readme): update installation steps
```

## Coding Standards

### JavaScript Style

```javascript
// Use ES6+ features
const fetchData = async () => {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

// Clear variable names
const politicalEntries = []; // Good
const pe = []; // Bad

// Comment complex logic
// Calculate severity based on multiple factors
const severity = calculateSeverity(impact, scope, urgency);

// Use const/let, not var
const API_KEY = 'key'; // Constant
let counter = 0; // Variable
```

### HTML/CSS Style

```html
<!-- Semantic HTML -->
<article class="entry-card">
  <header>
    <h2 class="entry-title">Title</h2>
  </header>
  <section class="entry-content">
    <p>Content here</p>
  </section>
</article>

<!-- Accessible forms -->
<label for="search">Search:</label>
<input id="search" type="search" aria-label="Search entries">
```

```css
/* Mobile-first CSS */
.entry-card {
  padding: 1rem;
  margin-bottom: 1rem;
}

/* Use CSS variables */
:root {
  --primary-color: #2c3e50;
  --danger-color: #e74c3c;
}

/* BEM naming convention */
.card {}
.card__title {}
.card__content {}
.card--featured {}
```

### SQL Style

```sql
-- Clear table and column names
CREATE TABLE political_entries (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    -- Add comments for complex columns
    severity TEXT CHECK (severity IN ('low', 'medium', 'high'))
);

-- Uppercase SQL keywords
SELECT id, title, date
FROM political_entries
WHERE archived = false
ORDER BY date DESC;
```

## Testing Requirements

### Before Submitting PR

- [ ] Code runs without errors
- [ ] No console warnings
- [ ] Tested in Chrome and Firefox
- [ ] Mobile responsive verified
- [ ] Accessibility checked
- [ ] Performance acceptable
- [ ] Documentation updated

### Test Coverage Areas

1. **Functionality**
   - Feature works as intended
   - Edge cases handled
   - Error states managed

2. **Compatibility**
   - Cross-browser testing
   - Mobile devices
   - Different screen sizes

3. **Performance**
   - Page load < 3 seconds
   - No memory leaks
   - Efficient queries

4. **Security**
   - Input sanitization
   - XSS prevention
   - SQL injection prevention

## Pull Request Process

### PR Checklist

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement

## Testing
- [ ] Tested locally
- [ ] Tested on mobile
- [ ] No console errors

## Screenshots
(if applicable)

## Related Issues
Fixes #123
```

### Review Process

1. **Automatic Checks**
   - GitHub Actions pass
   - No merge conflicts
   - Code formatting correct

2. **Manual Review**
   - Code quality
   - Performance impact
   - Security considerations
   - Documentation updates

3. **Approval Requirements**
   - At least 1 review
   - All comments addressed
   - Tests passing

### After Merge

1. Changes tested on `test` branch
2. Verified on test environment
3. Cherry-picked to `main` if approved
4. Deployed to production

## Reporting Issues

### Bug Reports

Use this template:

```markdown
**Bug Description**
Clear description of the issue

**Steps to Reproduce**
1. Go to...
2. Click on...
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Screenshots**
If applicable

**Environment**
- Browser:
- Device:
- OS:

**Additional Context**
Any other information
```

### Feature Requests

Use this template:

```markdown
**Feature Description**
What you want to add

**Use Case**
Why this would be useful

**Proposed Solution**
How it might work

**Alternatives Considered**
Other options explored

**Additional Context**
Mockups, examples, etc.
```

### Security Issues

**DO NOT** create public issues for security vulnerabilities!

Instead:
1. Email contact.trumpytracker@gmail.com
2. Include detailed description
3. Steps to reproduce
4. Potential impact
5. Suggested fix (if any)

## Recognition

### Contributors

All contributors will be recognized in:
- README.md contributors section
- CHANGELOG.md for significant contributions
- GitHub contributors page

### Types of Recognition

- 🐛 Bug Hunter - Found and reported bugs
- 💻 Code Contributor - Submitted merged PRs
- 📖 Documentation - Improved docs
- 🎨 Design - UI/UX improvements
- 🧪 Testing - Extensive testing contributions
- 🌍 Translation - Localization efforts

## Resources

### Documentation

- [README](../README.md) - Project overview
- [ARCHITECTURE](./ARCHITECTURE.md) - Technical details
- [API](./API.md) - API documentation
- [TESTING](./TESTING.md) - Testing guide
- [TROUBLESHOOTING](./TROUBLESHOOTING.md) - Common issues

### External Resources

- [Supabase Docs](https://supabase.com/docs)
- [GitHub Actions](https://docs.github.com/actions)
- [OpenAI API](https://platform.openai.com/docs)
- [Netlify Docs](https://docs.netlify.com)

### Communication Channels

- **GitHub Issues** - Bug reports and features
- **GitHub Discussions** - General discussion
- **Email** - contact.trumpytracker@gmail.com

## Development Tips

### Performance

- Use caching where appropriate
- Minimize API calls
- Optimize database queries
- Lazy load large datasets
- Compress images

### Security

- Never commit API keys
- Sanitize all inputs
- Use parameterized queries
- Implement rate limiting
- Follow OWASP guidelines

### Accessibility

- Use semantic HTML
- Add ARIA labels
- Ensure keyboard navigation
- Test with screen readers
- Maintain color contrast

### Code Quality

- Write self-documenting code
- Add comments for complex logic
- Keep functions small
- Use meaningful names
- Handle errors gracefully

## License

By contributing, you agree that your contributions will be licensed under the same public domain license as the project.

## Questions?

If you have questions about contributing:

1. Check existing documentation
2. Search closed issues
3. Ask in GitHub Discussions
4. Email contact.trumpytracker@gmail.com

Thank you for helping make government more transparent and accountable!

---

*Last Updated: August 17, 2025*
*Contributing Guide Version: 1.0*