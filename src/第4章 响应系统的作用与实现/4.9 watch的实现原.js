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
    return res;
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
      trigger(obj, "value");
    },
  });

  const obj = {
    get value() {
      if (dirty) {
        console.log("执行 effectFn");
        value = effectFn();
        dirty = false;
      }
      track(obj, "value");
      return value;
    },
  };

  return obj;
}


function traverse(value, seen = new Set()) {
  // 如果要读取的数据是原始值，或者已经被读取过了，那么什么都不做
  if (typeof value !== 'object' || value === null || seen.has(value)) return;

  // 将数据添加到 seen 中，代表遍历地读取过了，避免循环引用引起的死循环
  seen.add(value);

  // 暂时不考虑数组等其他结构
  // 假设 value 就是一个对象，使用 for...in 读取对象的每一个值，并递归地调用 traverse 进行处理
  for (const k in value) {
    traverse(value[k], seen);
  }

  return value;
}

// watch 函数接收两个参数，source 是响应式数据，cb 是回调函数
// function watch(source, cb) {
//   effect(
//     // 触发读取操作，从而建立联系
//     () => source.foo,
//     {
//       scheduler() {
//         // 当数据变化时，调用回调函数 cb
//         cb();
//       },
//     }
//   );
// }

// 将写死的 source.foo 改成活的
// function watch(source, cb) {
//   effect(
//     // 调用 traverse 递归地读取
//     // () => traverse(source),
//     () => {
//       const res = traverse(source)
//       console.log('res', res);
//       return res
//     },
//     {
//       scheduler() {
//         // 当数据变化时，调用回调函数 cb
//         cb();
//       }
//     }
//   );
// }

// 支持回调函数
// function watch(source, cb) {
//   // 定义 getter
//   let getter;
//   // 如果 source 是函数，说明用户传递的是 getter，所以直接把 source 赋值给 getter
//   if (typeof source === 'function') {
//     getter = source;
//   } else {
//     // 否则按照原来的实现调用 traverse 递归地读取
//     getter = () => traverse(source);
//   }

//   effect(
//     // 执行 getter
//     () => getter(),
//     {
//       scheduler() {
//         cb();
//       }
//     }
//   );
// }


// 添加旧值与新值
function watch(source, cb) {
  let getter;
  if (typeof source === 'function') {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  // 定义旧值与新值
  let oldValue, newValue;

  // 使用 effect 注册副作用函数时，开启 lazy 选项，并把返回值存储到 effectFn 中以便后续手动调用
  const effectFn = effect(
    () => getter(),
    {
      lazy: true,
      scheduler() {
        // 在 scheduler 中重新执行副作用函数，得到的是新值
        newValue = effectFn();
        // 将旧值和新值作为回调函数的参数
        cb(newValue, oldValue);
        // 更新旧值，不然下一次会得到错误的旧值
        oldValue = newValue;
      }
    }
  );

  // 手动调用副作用函数，拿到的值就是旧值
  oldValue = effectFn();
}



// watch(obj, () => {
//   console.log('数据变化了');
// })

watch(() => obj.foo, (newVal, oldVal) => {
  console.log('数据变化了', newVal, oldVal);
})


setTimeout(() => {
  console.log('准备改变数据');
  obj.foo++
}, 2000);
