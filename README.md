# ComicShelf

App para Android que permite leer cómics digitales directamente desde el almacenamiento del dispositivo.

## ¿Qué hace?

Accede a carpetas del teléfono mediante el sistema de permisos de Android (SAF), muestra los archivos organizados en un estante de libros visual, y permite abrirlos y leerlos página a página.

## Formatos soportados

- `.cbz` — el más común, extracción por streaming directo
- `.cbr` — soporte con librería junrar
- `.pdf` — renderizado nativo de Android

## Interfaz

- Estante de libros con planks de madera, portadas reales extraídas del archivo
- Navegación por carpetas y subcarpetas
- Lector inmersivo a pantalla completa con swipe entre páginas, scrubber de progreso arrastrable y rotación de pantalla
- Guarda el progreso por archivo (qué página ibas)
- Botón de atrás nativo de Android navega dentro de la app (lector → carpeta → raíz → minimizar)

## Filosofía técnica

Sin servidor, sin nube, sin cuenta. Todo local. Los archivos nunca se copian — se leen directamente donde están.

## Stack

- **Capacitor 6** — puente WebView ↔ Android nativo
- **HTML / CSS / JS vanilla** — interfaz sin frameworks
- **Java (plugin nativo)** — extracción de archivos, thumbnails, PDF rendering
- **SAF (Storage Access Framework)** — acceso a archivos sin permisos de almacenamiento total
