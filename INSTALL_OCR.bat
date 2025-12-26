@echo off
echo =========================================
echo Installing Advanced Paystub OCR System
echo =========================================
echo.

echo Installing required npm packages...
call npm install tesseract.js react-pdf@9.1.0

echo.
echo Installation complete!
echo.
echo =========================================
echo Next Steps:
echo =========================================
echo.
echo 1. Start your development server:
echo    npm run dev
echo.
echo 2. Navigate to:
echo    http://localhost:3000/paystub-ocr
echo.
echo 3. Upload a paystub PDF and test the extraction!
echo.
echo Read PAYSTUB_OCR_SETUP.md for detailed documentation
echo.
echo =========================================
echo Available Extraction Strategies:
echo =========================================
echo.
echo   PDF Text      - Fast, for digital PDFs
echo   Tesseract OCR - For scanned/image PDFs
echo   Claude Vision - AI-powered (most accurate)
echo   Manual Entry  - User input fallback
echo.
echo The system automatically falls back if one strategy fails!
echo.
pause
