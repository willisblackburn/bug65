int my_global = 42;

void my_func(int arg1) {
  int local_var = 10;
  local_var += arg1;
}

int main() {
  my_func(5);
  return 0;
}
