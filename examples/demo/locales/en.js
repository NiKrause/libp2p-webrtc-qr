/**
 * This demo's own text, English.
 *
 * The elements' text is not here - the library carries it, in both languages
 * (`QR_STATUS_STRINGS` and `QR_STATUS_STRINGS_DE` and their siblings). What
 * belongs here is what this page says in its own voice.
 *
 * Only the language control lives here so far. The rest of the page - the
 * headings, the explanations, and 53 diagnostic log lines - follows with the
 * view-mode work, where the log becomes technical-only and it will be clear
 * which of those a first-time reader ever sees.
 */
export default {
  language: {
    label: 'Language',
    en: 'English',
    de: 'Deutsch'
  }
}
