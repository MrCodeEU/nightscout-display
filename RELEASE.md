# How to Create a Release

This guide explains how to create a release that automatically builds and packages your plugin.

## Quick Release Process

### 1. Commit Your Changes
```bash
git add .
git commit -m "Version 1.0.0 - Initial release"
```

### 2. Create and Push a Tag
```bash
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

### 3. Create GitHub Release
1. Go to your repository on GitHub
2. Click **"Releases"** (right sidebar)
3. Click **"Create a new release"**
4. Select your tag: **v1.0.0**
5. Add a title: **"Nightscout Display v1.0.0"**
6. Add description (see template below)
7. Click **"Publish release"**

### 4. Automatic Build
GitHub Actions will automatically:
- ✅ Build the plugin
- ✅ Package it as `.streamDeckPlugin`
- ✅ Attach it to your release

Wait 2-3 minutes for the build to complete.

### 5. Users Can Install
Users can now:
1. Go to Releases page
2. Download `com.mrcodeeu.nightscout-display.streamDeckPlugin`
3. Double-click to install
4. Done!

## Release Description Template

```markdown
## 🎉 What's New

### ✨ Features
- Beautiful graph visualization with 4-48 hour time ranges
- Trend arrows (⇈ ↑ ↗ → ↘ ↓ ⇊) in both views
- 30-second refresh rate for rapid updates
- Click to toggle between number and graph views
- Long press to force refresh

### 🎨 Improvements
- Enhanced graph readability with glow effects
- Y-axis labels for easy reading
- Gradient backgrounds for glucose zones
- Professional threshold lines
- Shadow effects on text for better contrast

## 📥 Installation

1. Download `com.mrcodeeu.nightscout-display.streamDeckPlugin` below
2. Double-click the file to install
3. Drag "Nightscout Display" action to any Stream Deck key
4. Configure with your Nightscout URL

## ⚙️ Configuration

- Enter your Nightscout URL
- Add API token if site is private
- Choose your preferred unit (mg/dL or mmol/L)
- Select graph time range (4-48 hours)
- Customize thresholds and colors

## 📖 Documentation

Full documentation: [README.md](https://github.com/MrCodeEU/nightscout-display/blob/main/README.md)

## 🐛 Known Issues

None at this time.

## 💝 Support

Found this useful? Star the repo and share with others!
```

## Manual Build (Development)

If you need to build manually without creating a release:

```bash
# Build the plugin
npm run build

# Package it
streamdeck pack com.mrcodeeu.nightscout-display.sdPlugin

# This creates: com.mrcodeeu.nightscout-display.streamDeckPlugin
# Share this file with others
```

## Testing Before Release

Before creating an official release:

```bash
# Build locally
npm run build

# Link for testing
streamdeck link com.mrcodeeu.nightscout-display.sdPlugin

# Test on your Stream Deck

# When ready, create the release
```

## Workflow File Location

The GitHub Actions workflow is at:
```
.github/workflows/release.yml
```

It runs automatically when you:
- Create a new release (recommended)
- Manually trigger via Actions tab

## Troubleshooting Workflow

If the workflow fails:

1. **Check Actions Tab**
   - Go to repository → Actions
   - Click on failed workflow
   - View logs to see error

2. **Common Issues**
   - Node version mismatch: Check node version in workflow matches package.json
   - Missing dependencies: Ensure package-lock.json is committed
   - Build errors: Test `npm run build` locally first

3. **Manual Upload**
   If workflow fails, you can manually build and upload:
   ```bash
   npm run build
   streamdeck pack com.mrcodeeu.nightscout-display.sdPlugin
   ```
   Then manually attach the `.streamDeckPlugin` file to your release.

## Next Steps

After your first release:
1. Update README with correct release badge URL
2. Add screenshots/GIFs to README
3. Share in diabetes and Stream Deck communities
4. Respond to issues and feature requests
5. Plan next version improvements
