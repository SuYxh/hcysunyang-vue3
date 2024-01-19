import { effect, reactive } from 'vue';


const obj = reactive({ foo: true, bar: true });
let temp1, temp2;

// debugger
// effectFn1 嵌套了 effectFn2
effect(function effectFn1() {
  console.log("effectFn1 执行");

  effect(function effectFn2() {
    console.log("effectFn2 执行");
    // 在 effectFn2 中读取 obj.bar 属性
    temp2 = obj.bar;
  });

  // 在 effectFn1 中读取 obj.foo 属性
  temp1 = obj.foo;
});

setTimeout(() => {
  obj.foo = false
}, 1000);

setTimeout(() => {
  obj.bar = false
}, 2000);
