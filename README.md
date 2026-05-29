# PrintQ Agent

A desktop application for managing print queues with QR code support and cloud integration. Built with Electron and designed for Windows.

## Features

- **Print Queue Management** - Queue documents and manage printing workflow
- **QR Code Support** - Generate and manage QR codes for print jobs
- **Printer Detection** - Automatically detect and select available printers
- **PDF & HTML Printing** - Print PDF documents and HTML content
- **Cloud Integration** - Sync with Supabase backend for centralized management
- **Real-time Monitoring** - Background workers for queue monitoring and job processing
- **Automatic Icon Generation** - Asset management for application icons

## System Requirements

- **Node.js** - v14 or higher
- **Windows** - 7 SP1 or later (64-bit recommended)
- **Printer** - At least one printer installed and configured
- **Internet** - Required for Supabase cloud sync and QR code generation

## Installation

### From Installer
1. Download the latest `.exe` installer from releases
2. Run the installer and follow the on-screen instructions
3. Launch PrintQ Agent from your applications menu

### Development Installation
1. Clone the repository
2. Navigate to the project directory:
   ```bash
   cd printq-agent
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Create a `.env` file in the project root with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# QR Code Configuration
QR_REFRESH_SECONDS=30

# Application Settings
DEBUG=true
```

## Usage

### Running in Development
```bash
npm start
```

### Building for Windows
Build an installer:
```bash
npm run build:win
```

Build without installer:
```bash
npm run build
```

### Generate Application Icons
```bash
npm run icons
```

## Project Structure

```
printq-agent/
├── agent.js              # Main agent logic
├── cleanup.js            # Cleanup utilities
├── env.js                # Environment configuration
├── main.js               # Electron main process
├── preload.js            # Preload scripts for security
├── print.js              # Core printing functionality
├── printer.js            # Printer detection and management
├── qr.js                 # QR code generation and management
├── queue.js              # Print queue management
├── queueWorker.js        # Background worker for queue processing
├── supabase.js           # Supabase integration
├── index.html            # Main UI
├── package.json          # Project dependencies
├── assets/
│   └── icons/            # Application icons
└── scripts/
    ├── generate-icons.js # Icon generation script
    └── start-electron.js # Electron startup script
```

## Key Modules

### `main.js`
The Electron main process that creates and manages application windows, handles QR code updates, and manages system tray integration.

### `printer.js`
Manages printer detection, printer selection, and PDF printing capabilities using the `pdf-to-printer` library.

### `queue.js`
Implements print queue management with job tracking and status updates.

### `queueWorker.js`
Background worker process that continuously monitors and processes print jobs from the queue.

### `qr.js`
Handles QR code generation, refresh intervals, and QR code upload configuration.

### `supabase.js`
Manages cloud synchronization with Supabase backend for centralized data storage.

## Dependencies

### Production
- **@supabase/supabase-js** - Cloud backend integration
- **axios** - HTTP client for API requests
- **pdf-to-printer** - PDF printing functionality
- **qrcode** - QR code generation
- **serialport** - Serial port communication (for receipt printers, etc.)

### Development
- **electron** - Desktop application framework
- **electron-builder** - Application packaging and distribution

## Building & Distribution

The application uses Electron Builder to create Windows installers with the following configuration:

- **Installer Type**: NSIS (Nullsoft Scriptable Install System)
- **Installation Type**: Per-user (not per-machine)
- **Target Architecture**: 64-bit Windows
- **Code Signing**: Optional (currently disabled)

## Environment & Clock Management

The application includes internet clock checking for time synchronization and QR code validation. The QR configuration refresh interval can be adjusted via the `QR_REFRESH_SECONDS` environment variable.

## Security

- Uses Electron preload scripts to safely expose IPC channels
- Implements secure communication between main and renderer processes
- Stores sensitive configuration in environment variables

## Troubleshooting

### Printers not detected
- Ensure at least one printer is installed and set as available in Windows
- Restart the application
- Check Windows Print Spooler service is running

### QR codes not generating
- Verify internet connection
- Check Supabase credentials in `.env` file
- Review application logs for API errors

### Print jobs failing
- Check printer availability and paper/ink levels
- Ensure PDF files are not corrupted
- Review queue worker logs for processing errors

## License

ISC

## Support

For issues and feature requests, please open an issue in the repository.

---

**Version**: 1.0.0  
**Author**: Syam  
**App ID**: com.syam.printagent
