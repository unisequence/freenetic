#ifndef FNC_CMD_HELP_H
#define FNC_CMD_HELP_H

/* topic may be NULL (print everything) or a section name/alias
 * ("show", "interface", "internet", ...). Returns 0 always — an
 * unknown topic just prints the list of known ones to stderr. */
int fnc_help(const char *topic);

#endif
