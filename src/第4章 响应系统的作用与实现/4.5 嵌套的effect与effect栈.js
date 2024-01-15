const data = { ok: true, text: "hello world", foo: true, bar: true };

const bucket = new WeakMap();
// 用一个全局变量存储被注册的副作用函数
let activeEffect;
// effect 栈
const effectStack = []; 

const obj = new Proxy(data, {
  // 拦截读取操作
  get(target, key) {
    // 将副作用函数 activeEffect 添加到存储副作用函数的桶中
    track(target, key);
    // 返回属性值
    return target[key];
  },
  // 拦截设置操作
  set(target, key, newVal) {
    // 设置属性值
    target[key] = newVal;
    // 把副作用函数从桶里取出并执行
    trigger(target, key);
    // 返回 true 是解决 Uncaught TypeError: 'set' on proxy: trap returned falsish for property 'ok' 这个报错
    // 实际上应该配合 Reflect.set() 使用
    return true;
  },
});

// 在 get 拦截函数内调用 track 函数追踪变化
function track(target, key) {
  // 没有 activeEffect，直接 return
  if (!activeEffect) return;
  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }
  deps.add(activeEffect);
  // deps就是当前副作用函数存在联系的依赖集合
  // 将其添加到activeEffect.deps数组中
  activeEffect.deps.push(deps);
}

function trigger(target, key) {
  // 获取与目标对象相关联的依赖映射
  const depsMap = bucket.get(target);
  // 如果没有依赖映射，则直接返回
  if (!depsMap) return;
  // 获取与特定属性键相关联的所有副作用函数
  const effects = depsMap.get(key);

  // 创建一个新的 Set 来存储需要执行的副作用函数，避免在执行过程中的重复或无限循环
  const effectsToRun = new Set(effects);
  // 遍历并执行所有相关的副作用函数
  effectsToRun.forEach((effectFn) => effectFn());
}

// effect 函数用于注册副作用函数
function effect(fn) {
  const effectFn = () => {
    cleanup(effectFn);
    // 当调用 effect 注册副作用函数时，将副作用函数赋值给 activeEffect
    activeEffect = effectFn;
    // 在调用副作用函数之前将当前副作用函数压入栈中
    effectStack.push(effectFn); // 新增
    fn();
    // 在当前副作用函数执行完毕后，将当前副作用函数弹出栈，并把 activeEffect 还原为之前的值
    effectStack.pop(); // 新增
    activeEffect = effectStack[effectStack.length - 1]; // 新增
  };
  // activeEffect.deps 用来存储所有与该副作用函数相关的依赖集合
  effectFn.deps = [];
  // 执行副作用函数
  effectFn();
}

function cleanup(effectFn) {
  // 遍历 effectFn.deps 数组
  for (let i = 0; i < effectFn.deps.length; i++) {
    // deps 是依赖集合
    const deps = effectFn.deps[i];
    // 将 effectFn 从依赖集合中移除
    deps.delete(effectFn);
  }
  // 最后需要重置 effectFn.deps 数组
  effectFn.deps.length = 0;
}

// 全局变量
let temp1, temp2;

// effectFn1 嵌套了 effectFn2
// debugger
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
  // debugger
  obj.foo = false
}, 2000);