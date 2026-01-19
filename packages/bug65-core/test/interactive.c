
#include <stdio.h>
#include <unistd.h>

int main() {
  char c = 0;
  printf("Type something and press ENTER (q to quit):\\n");
  while (c != 'q') {
    c = getchar();
    if (c != EOF) {
      printf("You typed: %c (0x%02x)\\n", c, c);
    }
  }
  printf("Bye!\\n");
  return 0;
}
