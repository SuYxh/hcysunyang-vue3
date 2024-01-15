const data = { ok: true, text: "hello world", foo: 1, bar: 1, age: 1 };

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
  const depsMap = bucket.get(target);
  if (!depsMap) return;
  const effects = depsMap.get(key);

  const effectsToRun = new Set();
  effects &&
    effects.forEach((effectFn) => {
      // 如果 trigger 触发执行的副作用函数与当前正在执行的副作用函数相同，则不触发执行
      if (effectFn !== activeEffect) {
        effectsToRun.add(effectFn);
      }
    });
  effectsToRun.forEach((effectFn) => {
    if (effectFn.options.scheduler) {
      effectFn.options.scheduler(effectFn);
    } else {
      effectFn();
    }
  });
  // effects && effects.forEach(effectFn => effectFn())
}

// effect 函数用于注册副作用函数
function effect(fn, options = {}) {
  const effectFn = () => {
    cleanup(effectFn);
    // 当调用 effect 注册副作用函数时，将副作用函数赋值给 activeEffect
    activeEffect = effectFn;
    // 在调用副作用函数之前将当前副作用函数压栈
    effectStack.push(effectFn);
    const res = fn();
    // 在当前副作用函数执行完毕后，将当前副作用函数弹出栈，并把 activeEffect 还原为之前的值
    effectStack.pop();
    activeEffect = effectStack[effectStack.length - 1];
    return res
  };
  // 将 options 挂载到 effectFn 上
  effectFn.options = options; // 新增
  // activeEffect.deps 用来存储所有与该副作用函数相关的依赖集合
  effectFn.deps = [];
  // 只有非 lazy 的时候，才执行
  if (!options.lazy) {
    // 执行副作用函数
    effectFn();
  }

  return effectFn;
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

// 懒计算
// function computed(getter) {
//   // 把 getter 作为副作用函数，创建一个 lazy 的 effect
//   const effectFn = effect(getter, {
//     lazy: true
//   });

//   const obj = {
//     // 当读取 value 时才执行 effectFn
//     get value() {
//       return effectFn();
//     }
//   };

//   return obj;
// }

// 增加缓存
// function computed(getter) {
//   // value 用来缓存上一次计算的值
//   let value;
//   // dirty 标志，用来标识是否需要重新计算值，为 true 则意味着“脏”，需要计算
//   let dirty = true;

//   const effectFn = effect(getter, {
//     lazy: true,
//     scheduler() {
//       dirty = true
//     }
//   });

//   const obj = {
//     get value() {
//       // 只有“脏”时才计算值，并将得到的值缓存到 value 中
//       if (dirty) {
//         console.log('computed-->执行effectFn');
//         value = effectFn();
//         // 将 dirty 设置为 false，下一次访问直接使用缓存到 value 中的值
//         dirty = false;
//       }
//       return value;
//     }
//   };

//   return obj;
// }

function computed(getter) {
  let value;
  let dirty = true;

  const effectFn = effect(getter, {
    lazy: true,
    // 添加调度器，在调度器中将 dirty 重置为 true
    scheduler() {
      dirty = true;
      trigger(obj, 'value')
    }
  });

  const obj = {
    get value() {
      if (dirty) {
        console.log('执行 effectFn');
        value = effectFn();
        dirty = false;
      }
      track(obj, 'value')
      return value;
    }
  };

  return obj;
}


const sum = computed(() => {
  console.log('computed');
  return obj.foo + obj.bar
})


effect(() => {
  // 在该副作用函数中读取 sum.value
  console.log(sum.value);
});

// 修改 obj.foo 的值
obj.foo++;


// const effectFn = effect(
//   // 指定了 lazy 选项，这个函数不会立即执行
//   () => {
//     return obj.foo + obj.bar
//   },
//   // options
//   {
//     lazy: true,
//   }
// );

// const value = effectFn()
// console.log('value', value);