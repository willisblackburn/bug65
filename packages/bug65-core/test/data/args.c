#include <stdio.h>

void print_message(const char* message) {
    printf("%s\n", message);
}

int main(int argc, char* argv[]) {
    int i;
    const char message[] = "Goodbye";
    printf("argc = %d\n", argc);
    for (i = 0; i < argc; i++) {
        int length;
        length = printf("argv[%d] = %s\n", i, argv[i]);
        if (length < 0) {
            return -1;
        }
    }
    print_message(message);
    return 0;
}
