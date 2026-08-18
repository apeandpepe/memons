@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem ============================================================
rem  MEMONS - add a silent audio track to videos that have none
rem
rem  iOS Safari often refuses to render an mp4 with no audio track
rem  at all. Re-encoding stripped it, which is why the capsule and
rem  intro videos went black on iPhone while desktop stayed fine.
rem
rem  The video stream is copied, not re-encoded: no quality loss,
rem  a few kilobytes added, and it finishes in seconds.
rem
rem  Originals are kept as <name>.mp4.bak in the same folder.
rem ============================================================

set FF=C:\ffmpeg\bin\ffmpeg.exe
set FP=C:\ffmpeg\bin\ffprobe.exe

if not exist "%FF%" (
  echo [ERROR] ffmpeg not found at %FF%
  pause & exit /b 1
)
if not exist "%FP%" (
  echo [ERROR] ffprobe not found at %FP%
  pause & exit /b 1
)

cd /d "%~dp0"
echo Scanning for mp4 files without audio...
echo.

set /a FIXED=0
set /a SKIPPED=0

for /r "images" %%F in (*.mp4) do (
  set "SRC=%%F"
  set "HASAUDIO="

  for /f "delims=" %%A in ('"%FP%" -v error -select_streams a -show_entries stream^=codec_type -of csv^=p^=0 "%%F" 2^>nul') do set "HASAUDIO=%%A"

  if defined HASAUDIO (
    echo   skip : %%~nxF  ^(audio present^)
    set /a SKIPPED+=1
  ) else (
    echo   fix  : %%~nxF
    "%FF%" -y -v error -i "%%F" -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 ^
      -c:v copy -c:a aac -b:a 16k -shortest -movflags +faststart "%%~dpnF.tmp.mp4"
    if exist "%%~dpnF.tmp.mp4" (
      if not exist "%%F.bak" copy /y "%%F" "%%F.bak" >nul
      move /y "%%~dpnF.tmp.mp4" "%%F" >nul
      set /a FIXED+=1
    ) else (
      echo          FAILED - original left alone
    )
  )
)

echo.
echo Done.  fixed: %FIXED%   skipped: %SKIPPED%
echo Originals saved as *.mp4.bak
echo.
echo If everything plays correctly, the .bak files can be deleted.
echo They are excluded from git by .gitignore.
pause
