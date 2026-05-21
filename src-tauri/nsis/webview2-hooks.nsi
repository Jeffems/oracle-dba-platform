!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Verificando Microsoft Edge WebView2 Runtime..."

  IfFileExists "$INSTDIR\resources\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" 0 webview2_not_packaged

  DetailPrint "Instalando Microsoft Edge WebView2 Runtime..."
  ExecWait '"$INSTDIR\resources\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $0
  DetailPrint "Microsoft Edge WebView2 Runtime finalizado. Código: $0"
  Goto webview2_done

  webview2_not_packaged:
    DetailPrint "WebView2 Runtime não foi encontrado no pacote. Pulando instalação."

  webview2_done:
!macroend
