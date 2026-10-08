/* ============================================================
   HackAgon — seed.js
   Real content shipped with the database on day one:
   a seed set of genuine questions per topic, a library of
   free / open-licence books, and achievement definitions.
   This is content, NOT fake user statistics.
   ============================================================ */

window.HACKAGON_SEED = (function () {
  const ALL_LANGS = ["java", "python", "cpp", "c", "javascript"];

  /* Helper to build multi-language starters from a signature set */
  function stubs(sig, hint) {
    return {
      javascript: `// ${hint}\n${sig.js} {\n  \n}`,
      python:     `# ${hint}\n${sig.py}\n    pass`,
      java:       `// ${hint}\nclass Solution {\n    ${sig.java} {\n        \n    }\n}`,
      cpp:        `// ${hint}\n${sig.cpp} {\n    \n}`,
      c:          `/* ${hint} */\n${sig.c} {\n    \n}`
    };
  }

  const questions = [
    {
      id: "q-two-sum",
      title: "Two Sum",
      topics: ["arrays"],
      difficulty: "easy",
      points: 100,
      timeLimitMin: 15,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given an array of integers <code>nums</code> and an integer <code>target</code>, return the indices of the two numbers that add up to <code>target</code>. Each input has exactly one solution, and you may not use the same element twice. Return the two indices in ascending order.",
      samples: [
        { input: "nums = [2, 7, 11, 15], target = 9", output: "[0, 1]", why: "nums[0] + nums[1] = 2 + 7 = 9." },
        { input: "nums = [3, 2, 4], target = 6", output: "[1, 2]", why: "nums[1] + nums[2] = 2 + 4 = 6." }
      ],
      sig: {
        js: "function solve(nums, target)",
        py: "def solve(nums, target):",
        java: "public int[] solve(int[] nums, int target)",
        cpp: "vector<int> solve(vector<int>& nums, int target)",
        c: "int* solve(int* nums, int n, int target)"
      },
      hint: "Return the two indices (ascending) whose values sum to target.",
      cases: [
        { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
        { args: [[3, 2, 4], 6], expected: [1, 2] },
        { args: [[3, 3], 6], expected: [0, 1] },
        { args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4] }
      ],
      unordered: true,
      approach: "Keep a map from value to index. For each number, check whether target - number was already seen; if so, return the two indices. One pass, O(n) time."
    },
    {
      id: "q-largest",
      title: "Largest in the Row",
      topics: ["arrays"],
      difficulty: "easy",
      points: 80,
      timeLimitMin: 10,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given a non-empty array of integers, return the largest value. Do it in a single pass without calling a built-in max/sort.",
      samples: [{ input: "[4, 9, 2, 11, 7]", output: "11", why: "11 is the greatest value." }],
      sig: {
        js: "function solve(nums)", py: "def solve(nums):", java: "public int solve(int[] nums)",
        cpp: "int solve(vector<int>& nums)", c: "int solve(int* nums, int n)"
      },
      hint: "Track the biggest value seen so far while walking the array once.",
      cases: [
        { args: [[4, 9, 2, 11, 7]], expected: 11 },
        { args: [[-3, -9, -1]], expected: -1 },
        { args: [[5]], expected: 5 },
        { args: [[1, 1, 1, 1]], expected: 1 }
      ],
      approach: "Start with the first element as best, then update best whenever a larger element appears. O(n)."
    },
    {
      id: "q-rotate",
      title: "Rotate the Array",
      topics: ["arrays"],
      difficulty: "medium",
      points: 150,
      timeLimitMin: 20,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Rotate an array of length <code>n</code> to the right by <code>k</code> steps, where <code>k</code> is non-negative and may be larger than <code>n</code>. Return the rotated array.",
      samples: [
        { input: "nums = [1,2,3,4,5,6,7], k = 3", output: "[5,6,7,1,2,3,4]", why: "Three right rotations move the last three to the front." }
      ],
      sig: {
        js: "function solve(nums, k)", py: "def solve(nums, k):", java: "public int[] solve(int[] nums, int k)",
        cpp: "vector<int> solve(vector<int>& nums, int k)", c: "int* solve(int* nums, int n, int k)"
      },
      hint: "Reduce k modulo n, then reassemble. Try the three-reversal trick.",
      cases: [
        { args: [[1, 2, 3, 4, 5, 6, 7], 3], expected: [5, 6, 7, 1, 2, 3, 4] },
        { args: [[-1, -100, 3, 99], 2], expected: [3, 99, -1, -100] },
        { args: [[1, 2], 5], expected: [2, 1] },
        { args: [[1, 2, 3], 0], expected: [1, 2, 3] }
      ],
      approach: "Set k = k % n. Reverse the whole array, then reverse the first k, then reverse the rest. O(n) time, O(1) extra space."
    },
    {
      id: "q-anagram",
      title: "Are They Anagrams?",
      topics: ["strings"],
      difficulty: "easy",
      points: 90,
      timeLimitMin: 12,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given two strings <code>a</code> and <code>b</code>, return <code>true</code> if <code>b</code> is an anagram of <code>a</code> (same letters, same counts), otherwise <code>false</code>.",
      samples: [
        { input: 'a = "listen", b = "silent"', output: "true", why: "Both use the letters l,i,s,t,e,n once." },
        { input: 'a = "rat", b = "car"', output: "false", why: "Different letters." }
      ],
      sig: {
        js: "function solve(a, b)", py: "def solve(a, b):", java: "public boolean solve(String a, String b)",
        cpp: "bool solve(string a, string b)", c: "int solve(char* a, char* b)"
      },
      hint: "Count the frequency of each letter in both strings and compare.",
      cases: [
        { args: ["listen", "silent"], expected: true },
        { args: ["rat", "car"], expected: false },
        { args: ["aacc", "ccac"], expected: false },
        { args: ["", ""], expected: true }
      ],
      approach: "Use a 26-size counter (or a map). Increment for a, decrement for b, then check all counts are zero. Lengths must match first."
    },
    {
      id: "q-reverse-words",
      title: "Reverse the Words",
      topics: ["strings"],
      difficulty: "medium",
      points: 140,
      timeLimitMin: 18,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given a sentence, reverse the order of the words and return it as a single clean string with no leading, trailing, or repeated spaces.",
      samples: [
        { input: '"the sky is blue"', output: '"blue is sky the"', why: "Words reversed, single spaces kept." },
        { input: '"  hello   world  "', output: '"world hello"', why: "Extra spaces are removed." }
      ],
      sig: {
        js: "function solve(s)", py: "def solve(s):", java: "public String solve(String s)",
        cpp: "string solve(string s)", c: "char* solve(char* s)"
      },
      hint: "Split on whitespace, drop empties, reverse, then join with one space.",
      cases: [
        { args: ["the sky is blue"], expected: "blue is sky the" },
        { args: ["  hello   world  "], expected: "world hello" },
        { args: ["a good   example"], expected: "example good a" },
        { args: ["single"], expected: "single" }
      ],
      approach: "Tokenise by whitespace, filter empty tokens, reverse the list, join with a single space."
    },
    {
      id: "q-longest-palindrome",
      title: "Longest Palindromic Substring",
      topics: ["strings", "dynamic-programming"],
      difficulty: "hard",
      points: 220,
      timeLimitMin: 30,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given a string <code>s</code>, return the longest contiguous substring that reads the same forwards and backwards. If several share the maximum length, return the one that starts earliest.",
      samples: [
        { input: '"babad"', output: '"bab"', why: '"bab" and "aba" are both valid; "bab" starts earlier.' },
        { input: '"cbbd"', output: '"bb"', why: '"bb" is the longest palindrome.' }
      ],
      sig: {
        js: "function solve(s)", py: "def solve(s):", java: "public String solve(String s)",
        cpp: "string solve(string s)", c: "char* solve(char* s)"
      },
      hint: "Expand around every centre (2n-1 centres) and keep the longest.",
      cases: [
        { args: ["babad"], expected: "bab" },
        { args: ["cbbd"], expected: "bb" },
        { args: ["a"], expected: "a" },
        { args: ["forgeeksskeegfor"], expected: "geeksskeeg" }
      ],
      approach: "For each index treat it as an odd-length centre and as an even-length centre; expand outward while characters match. Track the best start and length. O(n^2) time, O(1) space."
    },
    {
      id: "q-reverse-list",
      title: "Reverse a Linked List",
      topics: ["linked-lists"],
      difficulty: "medium",
      points: 160,
      timeLimitMin: 20,
      memoryLimitMB: 256,
      languages: ["java", "python", "cpp", "c"],
      statement:
        "You are given the head of a singly linked list as an array of values. Return the values of the list after reversing it. (On the judge the real input is list nodes; here it is the value array.)",
      samples: [{ input: "[1,2,3,4,5]", output: "[5,4,3,2,1]", why: "Pointers flipped end to end." }],
      sig: {
        js: "function solve(values)", py: "def solve(values):", java: "public int[] solve(int[] values)",
        cpp: "vector<int> solve(vector<int>& values)", c: "int* solve(int* values, int n)"
      },
      hint: "Walk the list keeping prev, curr, next and flip each pointer.",
      cases: [
        { args: [[1, 2, 3, 4, 5]], expected: [5, 4, 3, 2, 1] },
        { args: [[1, 2]], expected: [2, 1] },
        { args: [[]], expected: [] },
        { args: [[7]], expected: [7] }
      ],
      approach: "Iterative: keep prev=null; for each node store next, point node.next=prev, advance prev and curr. O(n) time, O(1) space."
    },
    {
      id: "q-middle-list",
      title: "Middle of the List",
      topics: ["linked-lists"],
      difficulty: "easy",
      points: 100,
      timeLimitMin: 12,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given the values of a linked list, return the values from the middle node to the end. With an even count, return from the second of the two middle nodes.",
      samples: [
        { input: "[1,2,3,4,5]", output: "[3,4,5]", why: "3 is the middle." },
        { input: "[1,2,3,4,5,6]", output: "[4,5,6]", why: "Second middle node is 4." }
      ],
      sig: {
        js: "function solve(values)", py: "def solve(values):", java: "public int[] solve(int[] values)",
        cpp: "vector<int> solve(vector<int>& values)", c: "int* solve(int* values, int n)"
      },
      hint: "Fast pointer moves two steps, slow moves one; when fast ends, slow is at the middle.",
      cases: [
        { args: [[1, 2, 3, 4, 5]], expected: [3, 4, 5] },
        { args: [[1, 2, 3, 4, 5, 6]], expected: [4, 5, 6] },
        { args: [[1]], expected: [1] },
        { args: [[1, 2]], expected: [2] }
      ],
      approach: "Tortoise and hare: slow advances 1, fast advances 2. When fast reaches the end, slow sits at the middle. O(n), O(1)."
    },
    {
      id: "q-balanced",
      title: "Balanced Brackets",
      topics: ["stacks"],
      difficulty: "medium",
      points: 150,
      timeLimitMin: 18,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given a string containing only the characters <code>()[]{}</code>, return <code>true</code> if every opening bracket is closed by the same type in the correct order.",
      samples: [
        { input: '"()[]{}"', output: "true", why: "All pairs are correct." },
        { input: '"([)]"', output: "false", why: "The pairs cross." }
      ],
      sig: {
        js: "function solve(s)", py: "def solve(s):", java: "public boolean solve(String s)",
        cpp: "bool solve(string s)", c: "int solve(char* s)"
      },
      hint: "Push openers on a stack; on a closer, the top must match.",
      cases: [
        { args: ["()[]{}"], expected: true },
        { args: ["([)]"], expected: false },
        { args: ["{[]}"], expected: true },
        { args: ["("], expected: false },
        { args: [""], expected: true }
      ],
      approach: "Use a stack. Push opening brackets; for a closing bracket pop and check it matches. Valid only if the stack is empty at the end. O(n)."
    },
    {
      id: "q-next-greater",
      title: "Next Greater Element",
      topics: ["stacks", "arrays"],
      difficulty: "medium",
      points: 170,
      timeLimitMin: 22,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "For each element in the array, return the first greater element to its right, or -1 if there is none.",
      samples: [{ input: "[4,5,2,25]", output: "[5,25,25,-1]", why: "Look right for the first bigger value." }],
      sig: {
        js: "function solve(nums)", py: "def solve(nums):", java: "public int[] solve(int[] nums)",
        cpp: "vector<int> solve(vector<int>& nums)", c: "int* solve(int* nums, int n)"
      },
      hint: "Use a monotonic decreasing stack of indices.",
      cases: [
        { args: [[4, 5, 2, 25]], expected: [5, 25, 25, -1] },
        { args: [[13, 7, 6, 12]], expected: [-1, 12, 12, -1] },
        { args: [[1, 2, 3, 4]], expected: [2, 3, 4, -1] },
        { args: [[4, 3, 2, 1]], expected: [-1, -1, -1, -1] }
      ],
      approach: "Scan left to right with a stack holding indices whose answer is unknown. When a bigger value arrives, it pops and answers all smaller ones. O(n)."
    },
    {
      id: "q-circular-queue",
      title: "Circular Queue Hits",
      topics: ["queues"],
      difficulty: "medium",
      points: 160,
      timeLimitMin: 20,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Simulate a queue of fixed capacity <code>k</code>. Given a list of <code>ops</code>, each either <code>['enq', value]</code> or <code>['deq']</code>, return the list of values returned by each <code>deq</code> in order. Dequeueing an empty queue returns -1, and enqueueing into a full queue is ignored.",
      samples: [
        { input: "k=2, ops=[enq 1, enq 2, deq, enq 3, deq, deq]", output: "[1,2,-1]", why: "Track front and back around the ring." }
      ],
      sig: {
        js: "function solve(k, ops)", py: "def solve(k, ops):", java: "public int[] solve(int k, int[][] ops)",
        cpp: "vector<int> solve(int k, vector<vector<int>>& ops)", c: "int* solve(int k, int ops[][2], int n)"
      },
      hint: "Keep a fixed array with head, tail and count; wrap indices with modulo k.",
      cases: [
        { args: [2, [[1, 1], [1, 2], [0], [1, 3], [0], [0]]], expected: [1, 2, -1] },
        { args: [1, [[0], [1, 5], [0], [0]]], expected: [-1, 5, -1] },
        { args: [3, [[1, 1], [1, 2], [1, 3], [1, 4], [0], [0], [0], [0]]], expected: [1, 2, 3, -1] }
      ],
      approach: "Fixed ring buffer with head, size and capacity. enq writes at (head+size)%k if size<k; deq reads head and advances. O(1) per op."
    },
    {
      id: "q-max-depth",
      title: "Max Depth of a Tree",
      topics: ["trees", "recursion"],
      difficulty: "easy",
      points: 110,
      timeLimitMin: 15,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "A binary tree is given as an array in level order, where <code>null</code> means no node. Return its maximum depth (number of nodes on the longest root-to-leaf path).",
      samples: [
        { input: "[3,9,20,null,null,15,7]", output: "3", why: "Longest path is 3-20-15 or 3-20-7." }
      ],
      sig: {
        js: "function solve(level)", py: "def solve(level):", java: "public int solve(Integer[] level)",
        cpp: "int solve(vector<int>& level)", c: "int solve(int* level, int n)"
      },
      hint: "Depth = 1 + max(depth of left, depth of right).",
      cases: [
        { args: [[3, 9, 20, null, null, 15, 7]], expected: 3 },
        { args: [[1, null, 2]], expected: 2 },
        { args: [[]], expected: 0 },
        { args: [[1]], expected: 1 }
      ],
      approach: "Build the tree from the level array (children of i are 2i+1 and 2i+2), then recurse: depth(node) = 1 + max(depth(left), depth(right))."
    },
    {
      id: "q-level-order",
      title: "Level Order Traversal",
      topics: ["trees", "queues"],
      difficulty: "medium",
      points: 180,
      timeLimitMin: 22,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given a binary tree as a level-order array with <code>null</code> gaps, return its values grouped level by level, left to right.",
      samples: [{ input: "[3,9,20,null,null,15,7]", output: "[[3],[9,20],[15,7]]", why: "One sub-list per depth." }],
      sig: {
        js: "function solve(level)", py: "def solve(level):", java: "public int[][] solve(Integer[] level)",
        cpp: "vector<vector<int>> solve(vector<int>& level)", c: "int** solve(int* level, int n)"
      },
      hint: "Breadth-first search with a queue, processing one level per loop.",
      cases: [
        { args: [[3, 9, 20, null, null, 15, 7]], expected: [[3], [9, 20], [15, 7]] },
        { args: [[1]], expected: [[1]] },
        { args: [[]], expected: [] }
      ],
      approach: "BFS with a queue. Record the queue size at the start of each level, dequeue exactly that many, and collect their children. O(n)."
    },
    {
      id: "q-islands",
      title: "Number of Islands",
      topics: ["graphs"],
      difficulty: "medium",
      points: 200,
      timeLimitMin: 25,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given an <code>n x m</code> grid of <code>'1'</code> (land) and <code>'0'</code> (water), count the islands. An island is land connected horizontally or vertically.",
      samples: [
        { input: "[[1,1,0],[0,1,0],[0,0,1]]", output: "2", why: "One blob top-left, one single cell bottom-right." }
      ],
      sig: {
        js: "function solve(grid)", py: "def solve(grid):", java: "public int solve(int[][] grid)",
        cpp: "int solve(vector<vector<int>>& grid)", c: "int solve(int** grid, int n, int m)"
      },
      hint: "On each unvisited land cell run DFS/BFS and sink the whole island.",
      cases: [
        { args: [[[1, 1, 0], [0, 1, 0], [0, 0, 1]]], expected: 2 },
        { args: [[[1, 1, 1], [0, 1, 0], [1, 1, 1]]], expected: 1 },
        { args: [[[0, 0], [0, 0]]], expected: 0 },
        { args: [[[1]]], expected: 1 }
      ],
      approach: "Scan the grid; each time you find land, increment the count and flood-fill (DFS/BFS) marking all connected land as visited. O(n*m)."
    },
    {
      id: "q-sort-colors",
      title: "Sort the Colours",
      topics: ["sorting", "arrays"],
      difficulty: "medium",
      points: 170,
      timeLimitMin: 20,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "An array holds only the values 0, 1 and 2 (red, white, blue). Sort it in place so equal values are adjacent in the order 0, 1, 2. Return the sorted array. Aim for a single pass.",
      samples: [{ input: "[2,0,2,1,1,0]", output: "[0,0,1,1,2,2]", why: "Dutch national flag ordering." }],
      sig: {
        js: "function solve(nums)", py: "def solve(nums):", java: "public int[] solve(int[] nums)",
        cpp: "vector<int> solve(vector<int>& nums)", c: "int* solve(int* nums, int n)"
      },
      hint: "Three pointers: low, mid, high. Swap 0s left and 2s right.",
      cases: [
        { args: [[2, 0, 2, 1, 1, 0]], expected: [0, 0, 1, 1, 2, 2] },
        { args: [[2, 0, 1]], expected: [0, 1, 2] },
        { args: [[0]], expected: [0] },
        { args: [[1, 2, 0]], expected: [0, 1, 2] }
      ],
      approach: "Dutch national flag: keep low, mid, high. If nums[mid]==0 swap with low and advance both; if 2 swap with high and lower high; else advance mid. One pass, O(1) space."
    },
    {
      id: "q-hanoi",
      title: "Tower of Hanoi Moves",
      topics: ["recursion"],
      difficulty: "easy",
      points: 120,
      timeLimitMin: 12,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Return the minimum number of moves needed to solve the Tower of Hanoi with <code>n</code> disks. The answer is 2^n - 1, but derive it with recursion: moves(n) = 2 * moves(n-1) + 1, moves(1) = 1.",
      samples: [{ input: "n = 3", output: "7", why: "2^3 - 1 = 7." }],
      sig: {
        js: "function solve(n)", py: "def solve(n):", java: "public long solve(int n)",
        cpp: "long long solve(int n)", c: "long long solve(int n)"
      },
      hint: "moves(n) = 2 * moves(n - 1) + 1, with moves(1) = 1.",
      cases: [
        { args: [1], expected: 1 },
        { args: [3], expected: 7 },
        { args: [5], expected: 31 },
        { args: [10], expected: 1023 }
      ],
      approach: "Base case moves(1)=1; otherwise 2*moves(n-1)+1. This equals 2^n - 1."
    },
    {
      id: "q-climbing-stairs",
      title: "Climbing Stairs",
      topics: ["dynamic-programming", "recursion"],
      difficulty: "easy",
      points: 130,
      timeLimitMin: 15,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "You can climb 1 or 2 steps at a time. Given <code>n</code> steps, return the number of distinct ways to reach the top.",
      samples: [
        { input: "n = 3", output: "3", why: "1+1+1, 1+2, 2+1." }
      ],
      sig: {
        js: "function solve(n)", py: "def solve(n):", java: "public int solve(int n)",
        cpp: "int solve(int n)", c: "int solve(int n)"
      },
      hint: "ways(n) = ways(n-1) + ways(n-2). Build bottom-up.",
      cases: [
        { args: [2], expected: 2 },
        { args: [3], expected: 3 },
        { args: [5], expected: 8 },
        { args: [10], expected: 89 }
      ],
      approach: "It is the Fibonacci sequence. Keep two rolling values and iterate from 2 to n. O(n) time, O(1) space."
    },
    {
      id: "q-coin-change",
      title: "Coin Change",
      topics: ["dynamic-programming"],
      difficulty: "medium",
      points: 190,
      timeLimitMin: 25,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given coin denominations <code>coins</code> and an <code>amount</code>, return the fewest coins that make up the amount, or -1 if it is impossible. You have unlimited coins of each denomination.",
      samples: [
        { input: "coins = [1,2,5], amount = 11", output: "3", why: "5 + 5 + 1." },
        { input: "coins = [2], amount = 3", output: "-1", why: "Impossible." }
      ],
      sig: {
        js: "function solve(coins, amount)", py: "def solve(coins, amount):", java: "public int solve(int[] coins, int amount)",
        cpp: "int solve(vector<int>& coins, int amount)", c: "int solve(int* coins, int n, int amount)"
      },
      hint: "dp[a] = 1 + min(dp[a - coin]) over every coin that fits.",
      cases: [
        { args: [[1, 2, 5], 11], expected: 3 },
        { args: [[2], 3], expected: -1 },
        { args: [[1], 0], expected: 0 },
        { args: [[186, 419, 83, 408], 6249], expected: 20 }
      ],
      approach: "Bottom-up DP: dp[0]=0, dp[a]=min over coins of dp[a-coin]+1 for a-coin>=0. Use a large sentinel for unreachable, return -1 if dp[amount] is still sentinel. O(amount * coins)."
    },
    {
      id: "q-lcs",
      title: "Longest Common Subsequence",
      topics: ["dynamic-programming", "strings"],
      difficulty: "hard",
      points: 230,
      timeLimitMin: 30,
      memoryLimitMB: 256,
      languages: ALL_LANGS,
      statement:
        "Given two strings, return the length of their longest common subsequence (a subsequence need not be contiguous). Return 0 if there is none.",
      samples: [
        { input: 'a = "abcde", b = "ace"', output: "3", why: '"ace" is the longest common subsequence.' }
      ],
      sig: {
        js: "function solve(a, b)", py: "def solve(a, b):", java: "public int solve(String a, String b)",
        cpp: "int solve(string a, string b)", c: "int solve(char* a, char* b)"
      },
      hint: "If last chars match, 1 + LCS(rest); else max of dropping one char from either side.",
      cases: [
        { args: ["abcde", "ace"], expected: 3 },
        { args: ["abc", "abc"], expected: 3 },
        { args: ["abc", "def"], expected: 0 },
        { args: ["bl", "yby"], expected: 1 }
      ],
      approach: "2D DP where dp[i][j] is the LCS of the first i chars of a and first j of b. Match -> dp[i-1][j-1]+1, else max(dp[i-1][j], dp[i][j-1]). O(n*m)."
    }
  ].map(q => ({ ...q, starters: stubs(q.sig, q.hint) }));

  /* --- Free / open-licence library (admin-confirmed) --------- */
  const books = [
    { id: "b-think-java", title: "Think Java", author: "Allen B. Downey & Chris Mayfield", subject: "Java", licence: "CC BY-NC-SA 3.0", url: "https://greenteapress.com/wp/think-java/" },
    { id: "b-java-notes", title: "Java Notes for Professionals", author: "GoalKicker (Stack Overflow docs)", subject: "Java", licence: "Free to share", url: "https://goalkicker.com/JavaBook/" },
    { id: "b-automate", title: "Automate the Boring Stuff with Python", author: "Al Sweigart", subject: "Python", licence: "CC BY-NC-SA 3.0", url: "https://automatetheboringstuff.com/" },
    { id: "b-byte-python", title: "A Byte of Python", author: "Swaroop C H", subject: "Python", licence: "CC BY-SA 4.0", url: "https://python.swaroopch.com/" },
    { id: "b-pythonds", title: "Problem Solving with Algorithms & Data Structures", author: "Brad Miller & David Ranum", subject: "Python", licence: "Free (Runestone)", url: "https://runestone.academy/ns/books/published/pythonds/index.html" },
    { id: "b-eloquent", title: "Eloquent JavaScript", author: "Marijn Haverbeke", subject: "JavaScript", licence: "CC BY-NC 3.0", url: "https://eloquentjavascript.net/" },
    { id: "b-ydkjs", title: "You Don't Know JS Yet", author: "Kyle Simpson", subject: "JavaScript", licence: "Free (open source)", url: "https://github.com/getify/You-Dont-Know-JS" },
    { id: "b-beej-c", title: "Beej's Guide to C", author: "Brian “Beej Jorgensen” Hall", subject: "C", licence: "Free (public-ish)", url: "https://beej.us/guide/bgc/" },
    { id: "b-ods", title: "Open Data Structures", author: "Pat Morin", subject: "Data structures", licence: "CC BY-SA", url: "http://opendatastructures.org/" },
    { id: "b-erickson", title: "Algorithms", author: "Jeff Erickson", subject: "Algorithms", licence: "CC BY 4.0", url: "https://jeffe.cs.illinois.edu/teaching/algorithms/" },
    { id: "b-cph", title: "Competitive Programmer's Handbook", author: "Antti Laaksonen", subject: "Competitive programming", licence: "Free PDF", url: "https://cses.fi/book/book.pdf" }
  ];

  /* --- Achievements (thresholds live here, not in code) ------ */
  const achievements = [
    { id: "a-first-blood", name: "First Blood", desc: "Win your first room.", metric: "roomsWon", target: 1, icon: "drop" },
    { id: "a-room-master", name: "Room Master", desc: "Win 20 rooms.", metric: "roomsWon", target: 20, icon: "crown" },
    { id: "a-tourney", name: "Tournament Conqueror", desc: "Win your first tournament.", metric: "tournamentsWon", target: 1, icon: "trophy" },
    { id: "a-duelist", name: "Duelist", desc: "Win 10 duels.", metric: "duelsWon", target: 10, icon: "swords" },
    { id: "a-perfectionist", name: "Perfectionist", desc: "Solve every question in a room.", metric: "perfectRooms", target: 1, icon: "star" },
    { id: "a-clean", name: "Clean Player", desc: "Finish 10 proctored matches with no violation.", metric: "cleanProctored", target: 10, icon: "shield" },
    { id: "a-scholar", name: "Scholar", desc: "Retry and solve 25 previously failed questions.", metric: "mistakesSolved", target: 25, icon: "book" }
  ];

  /* --- Platform-run practice rooms (free, no prize) ----------
     Real built-in content, not fabricated user activity.        */
  const platformRooms = [
    { name: "Daily Warm-up: Arrays", topics: ["arrays"], difficultyMix: "easy", durationMin: 30, questions: ["q-largest", "q-two-sum"] },
    { name: "Daily Warm-up: Strings", topics: ["strings"], difficultyMix: "easy", durationMin: 30, questions: ["q-anagram", "q-reverse-words"] },
    { name: "Stacks & Queues Drill", topics: ["stacks", "queues"], difficultyMix: "medium", durationMin: 45, questions: ["q-balanced", "q-next-greater", "q-circular-queue"] },
    { name: "Trees After Class", topics: ["trees"], difficultyMix: "medium", durationMin: 45, questions: ["q-max-depth", "q-level-order"] },
    { name: "DP Night Practice", topics: ["dynamic-programming"], difficultyMix: "hard", durationMin: 60, questions: ["q-climbing-stairs", "q-coin-change", "q-lcs"] },
    { name: "Graphs & Islands", topics: ["graphs"], difficultyMix: "medium", durationMin: 40, questions: ["q-islands"] }
  ];

  const topics = [
    { id: "arrays", label: "Arrays" }, { id: "strings", label: "Strings" },
    { id: "linked-lists", label: "Linked lists" }, { id: "stacks", label: "Stacks" },
    { id: "queues", label: "Queues" }, { id: "trees", label: "Trees" },
    { id: "graphs", label: "Graphs" }, { id: "sorting", label: "Sorting" },
    { id: "recursion", label: "Recursion" }, { id: "dynamic-programming", label: "Dynamic programming" }
  ];

  const languages = [
    { id: "java", label: "Java" }, { id: "python", label: "Python" },
    { id: "cpp", label: "C++" }, { id: "c", label: "C" }, { id: "javascript", label: "JavaScript" }
  ];

  const prizePresets = [
    { id: "winner-all", label: "Winner takes all", split: { 1: 100 } },
    { id: "top3", label: "Top 3", split: { 1: 50, 2: 30, 3: 20 } },
    { id: "top5", label: "Top 5", split: { 1: 40, 2: 25, 3: 15, 4: 10, 5: 10 } },
    { id: "custom", label: "Custom", split: {} }
  ];

  return { questions, books, achievements, platformRooms, topics, languages, prizePresets, ALL_LANGS };
})();
