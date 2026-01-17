# TrumpyTracker Changelog

All notable changes to TrumpyTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- User authentication system
- Email notifications for high-severity entries
- Data export functionality (CSV/JSON)
- Advanced search with multiple criteria
- Mobile app development
- API rate for external developers

## [2.1.0] - 2025-08-17

### Added
- Comprehensive documentation in `/docs` folder
- `.gitignore` file for better repository management
- Organized folder structure (scripts, config, sql, test)

### Changed
- Reorganized repository structure for better maintainability
- Moved scripts to `/scripts` folder
- Moved configuration files to `/config` folder
- Moved SQL files to `/sql` folder
- Updated GitHub Actions to reference new paths
- Enhanced README with complete project information

### Fixed
- File path references in workflows
- Test environment detection issues

## [2.0.0] - 2025-08-14

### Added
- Queue management system for article processing
- Test environment with separate database
- Branch-based deployment (test branch)
- Data replication tool (production to test)
- Health check pages for environment verification
- Client-side caching for performance
- Archive management functionality

### Changed
- Migrated from JSON files to Supabase (PostgreSQL)
- Switched to serverless architecture
- Improved dashboard performance with indexes
- Enhanced error handling and recovery
- Updated admin panel with tabbed interface

### Removed
- Local JSON file storage
- Manual data management scripts
- Legacy tracking scripts

## [1.5.0] - 2025-07-25

### Added
- Executive Orders tracking system
- Separate workflow for EO monitoring
- Federal Register integration
- Severity assessment for orders
- Category classification for EOs

### Changed
- Improved AI prompts for better accuracy
- Enhanced source verification logic
- Updated dashboard layout for EO section

### Fixed
- Duplicate detection algorithm
- Date parsing for various formats
- Source URL extraction

## [1.4.0] - 2025-07-15

### Added
- Manual article submission interface
- Admin panel with authentication
- Duplicate detection system
- Source verification badges
- Mobile responsive design

### Changed
- Dashboard UI improvements
- Better error messages
- Improved filtering performance

### Fixed
- Safari compatibility issues
- Touch event handling on mobile
- Cache invalidation bugs

## [1.3.0] - 2025-07-01

### Added
- Statistics dashboard
- Category distribution charts
- Trend analysis
- Daily entry counts
- Actor frequency tracking

### Changed
- Improved categorization accuracy
- Better severity assessment
- Enhanced AI analysis prompts

### Fixed
- Memory leaks in dashboard
- Incorrect date sorting
- Category filter bugs

## [1.2.0] - 2025-06-15

### Added
- GitHub Actions automation
- Daily scheduled runs
- Manual trigger capability
- Automatic releases
- Error logging

### Changed
- Switched from local scripts to GitHub Actions
- Improved error handling
- Better retry logic

### Fixed
- API timeout issues
- Rate limiting problems
- Connection failures

## [1.1.0] - 2025-06-01

### Added
- Search functionality
- Date range filtering
- Export to JSON
- Keyboard shortcuts
- Loading indicators

### Changed
- Improved UI/UX
- Better mobile experience
- Faster page loads

### Fixed
- Cross-browser compatibility
- Filter state persistence
- Search performance

## [1.0.0] - 2025-05-15

### Added
- Initial release
- Basic political tracking
- OpenAI integration
- Simple dashboard
- Category filtering
- Daily automation

### Features
- Track political figures
- Monitor government agencies
- Categorize by issue type
- Severity assessment
- Source attribution

## Development Timeline

### Phase 1: MVP (May 2025)
- Basic tracking functionality
- Simple web interface
- Manual data updates

### Phase 2: Automation (June 2025)
- GitHub Actions integration
- Scheduled daily runs
- Automated data collection

### Phase 3: Enhancement (July 2025)
- Admin panel
- Manual submissions
- Executive Orders tracking

### Phase 4: Migration (August 2025)
- Move to Supabase
- Test environment
- Queue management
- Documentation

### Phase 5: Future (Planned)
- User accounts
- API access
- Mobile apps
- Advanced analytics

## Version History

| Version | Date | Major Changes |
|---------|------|---------------|
| 2.1.0 | 2025-08-17 | Repository reorganization |
| 2.0.0 | 2025-08-14 | Supabase migration |
| 1.5.0 | 2025-07-25 | Executive Orders |
| 1.4.0 | 2025-07-15 | Admin panel |
| 1.3.0 | 2025-07-01 | Statistics |
| 1.2.0 | 2025-06-15 | Automation |
| 1.1.0 | 2025-06-01 | Search features |
| 1.0.0 | 2025-05-15 | Initial release |

## Breaking Changes

### v2.0.0
- Migrated from JSON to Supabase
- Changed all API endpoints
- New configuration format
- Updated deployment process

### v1.0.0
- Initial release (no breaking changes)

## Deprecated Features

### Removed in v2.0.0
- JSON file storage
- Local server scripts
- Manual update scripts

### Scheduled for Removal
- Legacy admin.html (use admin-supabase.html)
- Old configuration format

## Migration Guides

### v1.x to v2.0
1. Set up Supabase account
2. Run migration scripts
3. Update configuration files
4. Update GitHub secrets
5. Deploy new version

## Contributors

- AJ Wolfe - Project creator and maintainer
- OpenAI - AI processing
- Community - Bug reports and suggestions

## Environment Variables

### GitHub Secrets (Confirmed Active)
- `OPENAI_API_KEY` - Active since August 2025 for AI processing
- `SUPABASE_URL` - Database endpoint
- `SUPABASE_SERVICE_ROLE_KEY` - Admin access for automation

## License

Public Domain - See LICENSE file

---

*For latest updates, check the [GitHub repository](https://github.com/AJWolfe18/TTracker)*