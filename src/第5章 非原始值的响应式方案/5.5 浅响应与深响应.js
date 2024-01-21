const ITERATE_KEY = "iterate";

const TriggerType = {
  SET: "SET",
  ADD: "ADD",
  DEL: "DELETE",
};

const bucket = new WeakMap();
// 用一个全局变量存储被注册的副作用函数
let activeEffect;
// effect 栈
const effectStack = [];


function createReactive(data,  isShallow = false) {
  return new Proxy(data, {
    // 拦截读取操作
    get(target, key, receiver) {
      if (key === "raw") {
        return target;
      }
      const res = Reflect.get(target, key, receiver);
      // 将副作用函数 activeEffect 添加到存储副作用函数的桶中
      track(target, key);
      //  如果是浅响应，则直接返回原始值
      if (isShallow) {
        return res
      }

      if (typeof res === 'object' && res !== null) {
        return reactive(res)
      }

      // 返回属性值
      return res;
    },
    // 拦截设置操作
    set(target, key, newVal, receiver) {
      // 获取旧值
      const oldVal = target[key];

      // 如果属性不存在，则说明是在添加新属性，否则是设置已有属性
      const type = Object.prototype.hasOwnProperty.call(target, key)
        ? TriggerType.SET
        : TriggerType.ADD;

      const res = Reflect.set(target, key, newVal, receiver);

      // target === receiver.raw 说明 receiver 就是 target 的代理对象
      if (target === receiver.raw) {
        // 较新值与旧值，只有当它们不全等，并且不都是 NaN 的时候才触发响应
        if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
          // 把副作用函数从桶里取出并执行
          trigger(target, key, type);
        }
      }

      return res;
    },
    // 拦截 in 操作符
    has(target, key) {
      track(target, key);
      return Reflect.has(target, key);
    },
    // 拦截 for in 循环
    ownKeys(target) {
      // 将 ITERATE_KEY 作为追踪的 key ，为什么这么做呢？
      // 这是因为 ownKeys 拦截函数与 get/set 拦截函数不同，在set /get中，我们可以得到具体操作的 key，但是在 ownKeys中，我们只能拿到目标对象 target
      // ownKeys 用来获取一个对象的所有属于自己的键值，这个操作明显不与任何具体的键进行绑定，因此我们只能够构造唯一的 key作为标识，即 ITERATE_KEY。
      track(target, ITERATE_KEY);
      return Reflect.ownKeys(target);
    },
    // 拦截删除
    deleteProperty(target, key) {
      // 检查被操作的属性是否是对象自己的属性
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      // 使用 Reflect.deleteProperty 完成属性的删除
      const res = Reflect.deleteProperty(target, key);

      if (res && hadKey) {
        // 只有当被删除的属性是对象自己的属性并且成功删除时，才触发更新
        trigger(target, key, TriggerType.DEL);
      }

      return res;
    },
  });
}

function reactive(data) {
  return createReactive(data)
}

function shallowReactive(data) {
  return createReactive(data, true)
}

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

function trigger(target, key, type) {
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

  // 只有当操作类型为 'ADD' 时，才触发与 ITERATE_KEY 相关联的副作用函数重新执行
  if (type === TriggerType.ADD || type === TriggerType.DEL) {
    // 取得与 ITERATE_KEY 相关联的副作用函数
    const iterateEffects = depsMap.get(ITERATE_KEY);

    iterateEffects &&
      iterateEffects.forEach((effectFn) => {
        if (effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

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
    effectFn.fn = fn;
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
  if (typeof value !== "object" || value === null || seen.has(value)) return;

  // 将数据添加到 seen 中，代表遍历地读取过了，避免循环引用引起的死循环
  seen.add(value);

  // 暂时不考虑数组等其他结构
  // 假设 value 就是一个对象，使用 for...in 读取对象的每一个值，并递归地调用 traverse 进行处理
  for (const k in value) {
    traverse(value[k], seen);
  }

  return value;
}

// 添加旧值与新值
function watch(source, cb, options = {}) {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    // 为什么要使用 traverse ？traverse 的作用是什么？
    // traverse 的作用 对 对象进行递归读取
    // 为什么要使用 traverse： 进行依赖收集，对象上任意一项数据改变都会触发cb回调
    getter = () => traverse(source);
  }

  let oldValue, newValue;

  // 提取 scheduler 调度函数为一个独立的 job 函数
  const job = () => {
    newValue = effectFn();
    cb(newValue, oldValue);
    oldValue = newValue;
  };

  const effectFn = effect(
    // 执行 getter
    () => getter(),
    {
      lazy: true,
      // 使用 job 函数作为调度器函数
      scheduler: job,
    }
  );

  if (options.immediate) {
    // 当 immediate 为 true 时立即执行 job，从而触发回调执行
    console.log("准备执行 job");
    job();
  } else {
    oldValue = effectFn();
  }
}

/**
 * 以下为测试代码
 */

// 深层响应
// const obj = reactive({ foo: { bar: 1 } })

// effect(function effectFn1() {
//   console.log(obj.foo.bar)
// })

// // 修改 obj.foo.bar 的值，并不能触发响应
// obj.foo.bar = 2

// 浅响应
const obj = shallowReactive({ foo: { bar: 1 } });

effect(() => {
  console.log(obj.foo.bar);
});

// obj.foo 是响应的，可以触发副作用函数重新执行
obj.foo = { bar: 2 };

// obj.foo.bar 不是响应的，不能触发副作用函数重新执行
obj.foo.bar = 3;
